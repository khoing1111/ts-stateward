import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CodeActionKind,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  MarkupKind,
  ErrorCodes,
  MessageType,
  ResponseError,
  ShowMessageNotification,
  TextDocumentSyncKind,
  TextDocuments,
  type CodeAction,
  type Connection,
  type Diagnostic,
  type Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  BaselineError,
  NothingToCheckError,
  activeRuleIds,
  TsconfigError,
  TypeScriptLibMissingError,
  check,
  computeImplementationId,
  configLocalImports,
  createChecker,
  defaultCacheDir,
  displayPath,
  loadConfigFile,
  openDiskCache,
  reloadsLocalImports,
  resultsCacheLimit,
  toTypeScriptPath,
} from "@stateward/core/internal";
import type {
  Checker,
  CheckProgress,
  CheckResult,
  Config,
  DiskCache,
  Finding,
  HiddenFindings,
} from "@stateward/core/internal";
import {
  InvalidNextParamsError,
  NEXT_REQUEST,
  PLAN_REQUEST,
  RECHECK_REQUEST,
  STATUS_NOTIFICATION,
  applyNext,
  parseNextParams,
  planAnswer,
  rolloutOffAnswer,
  statusReport,
  type NextAnswer,
  type PlanAnswer,
} from "./adoption.js";
import { layBaseline } from "./baseline.js";
import {
  DEFAULT_HINT_SETTINGS,
  hintEnabled,
  readHintSettings,
  toInlayHints,
  type HintSettings,
} from "./inlay-hints.js";
import { InvalidExplainParamsError, answerExplain } from "./explain.js";
import {
  fixAllEdits,
  kindWanted,
  versionedAction,
  versionedEdit,
  type FixSite,
  type VerifyFixSet,
} from "./fix-all.js";
import { mergeFastPass } from "./merge.js";
import { SILENT_PROGRESS, withProgress, type ProgressReporter } from "./progress.js";
import { fastPassLine, fullPassLine, longestStepLine } from "./report.js";
import {
  TOKEN_TYPES,
  buildLineIndex,
  encodeTokens,
  offsetAt,
  rangesIntersect,
  toRange,
  toCodeActions,
  toLspChanges,
  toDiagnostic,
  toHiddenDiagnostic,
  toIgnoreAction,
  type FileMapper,
} from "./mapping.js";
import { SCRIPT_GLOB, classifyChange, createErrorGate, isImportableJson } from "./watch.js";
import { createConfigLocator, folderOf } from "./configs.js";

/** The wait after a config load, a watched-file change or a closed document, before a full pass. */
export const DEBOUNCE_MS = 200;
/** Quiet time after an edit before the fast pass (the edited file's own rules). */
export const FAST_MS = 100;
/** Quiet time after an edit before the full pass (the whole project); a save does not wait. */
export const FULL_MS = 1000;
/** A client that advertised progress but does not answer must not hold the check back. */
const PROGRESS_OPEN_TIMEOUT_MS = 500;
export const PROGRESS_TITLE = "Stateward: checking project";
/** Tells the extension a config's full pass started or ended, for its status bar. */
export const CHECKING_NOTIFICATION = "stateward/checking";
/** The least time between two progress reports of one full pass. */
const PROGRESS_REPORT_MS = 250;
export const FIX_ALL_KIND = `${CodeActionKind.SourceFixAll}.stateward`;
export const EXPLAIN_COMMAND = "stateward.explain";
export const EXPLAIN_REQUEST = "stateward/explain";

/** A review of fixes that takes at least this long is logged, to see what the menu costs. */
const REVIEW_LOG_MS = 50;

/** Quiet time after the last file of a nested config's project is closed, before its engine stops. */
export const ENGINE_IDLE_MS = 5 * 60 * 1000;

/**
 * The least time between two writes of a config's results cache to disk: a write follows a full
 * pass that completed, at most this often, and a config that stops (or a server that shuts down)
 * writes what it has not written yet.
 */
export const DISK_SAVE_MS = 30 * 1000;

/** What one config's checker is doing: loading the config, checking, or waiting for a fixed config. */
type EngineState =
  | { kind: "loading" }
  | { kind: "ready"; config: Config; checker: Checker }
  /** The config cannot be loaded; a change to it tries again. */
  | { kind: "unconfigured" };

/**
 * One config and everything the server keeps for it: its checker, its timers, and what it last
 * published. A config at the root of a workspace folder is `pinned`: it is checked from the start
 * and kept, like a single project always was. A nested one starts when one of its files is opened
 * and stops a while after the last one is closed.
 */
type Engine = {
  readonly configFile: string;
  /** The config's folder: the project's folder for the checker. */
  readonly cwd: string;
  readonly pinned: boolean;
  state: EngineState;
  /** Bumped by every config load, so a slow load that has been overtaken is dropped. */
  generation: number;
  fastTimer: NodeJS.Timeout | undefined;
  fullTimer: NodeJS.Timeout | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  /** Open files edited since the last pass, by path. */
  pendingFast: Set<string>;
  /** The full pass that is running, if one is: it checks in slices and stops when cancelled. */
  fullRun: FullRun | undefined;
  /** A full pass was asked for while one was running: it runs again when that one ends. */
  fullAgain: boolean;
  /** The first full pass ended: later passes run quietly (the status bar shows them, no progress). */
  firstFullDone: boolean;
  published: Set<string>;
  /** Per file, the findings that offer actions; their fixes are tried when the menu is asked for. */
  fixSites: Map<string, readonly PendingSite[]>;
  /** The version of each open document (by path) that `fixSites` were computed against. */
  fixVersions: Map<string, number>;
  /** The local files the config imports (TypeScript paths): a change to one reloads the config. */
  configImports: ReadonlySet<string>;
  /**
   * The results cache on disk the checker started from and is written back to (the CLI's file:
   * core's disk-cache.ts); undefined when the project has no cache folder.
   */
  disk: DiskCache | undefined;
  /** A write of `disk` waiting for `DISK_SAVE_MS` since the last one. */
  saveTimer: NodeJS.Timeout | undefined;
  /** When `disk` was last written (`performance.now()`); undefined before the first write. */
  savedAt: number | undefined;
};

/** "1,200 of 3,000 files", or "project rules 3 of 13": where a full pass stands. */
function progressMessage(at: CheckProgress): string {
  return at.phase === "files"
    ? `${at.done.toLocaleString("en-US")} of ${at.total.toLocaleString("en-US")} files`
    : `project rules ${String(at.done)} of ${String(at.total)}`;
}

/** The files are most of a pass: they take 0 to 90%, the project rules the rest. */
function progressPercentage(at: CheckProgress): number {
  const share = at.total === 0 ? 1 : at.done / at.total;
  return Math.floor(at.phase === "files" ? 90 * share : 90 + 10 * share);
}

/** A running full pass; an edit or a newer full pass sets `cancelled`, and it stops at its next slice. */
type FullRun = { cancelled: boolean };

/**
 * A finding the editor may offer actions for, kept as it was published. Its fixes are tried
 * (`Checker.reviewFixes`) only when the editor asks for the menu, so a pass stays fast.
 */
type PendingSite = {
  range: FixSite["range"];
  finding: Finding;
  diagnostic: Diagnostic;
  /** Maps the finding's offsets with the text it was computed on. */
  files: FileMapper;
  ignore?: CodeAction;
};

function isTypeScriptFile(uri: string): boolean {
  return uri.startsWith("file:") && /\.(?:[mc]?ts|tsx)$/.test(uri);
}

/** A document the editor syncs to the server: TypeScript, or a JSON file a program may import. */
function isSyncedFile(uri: string): boolean {
  return isTypeScriptFile(uri) || (uri.startsWith("file:") && isImportableJson(fileURLToPath(uri)));
}

/** The popup text for an error from a check. The errors stateward names are already readable. */
function checkErrorText(error: unknown): string {
  if (
    error instanceof NothingToCheckError ||
    error instanceof TsconfigError ||
    error instanceof TypeScriptLibMissingError
  ) {
    return `${error.message}. Fix: ${error.hint}`;
  }
  // The message already says which file and what to do.
  if (error instanceof BaselineError) return `stateward: ${error.message}`;
  return `stateward check failed: ${describe(error)}`;
}

/** "Explain <rule id>" for each rule among the stateward diagnostics; the client runs `stateward.explain`. */
function explainActions(diagnostics: readonly Diagnostic[]): CodeAction[] {
  const ruleIds = new Set(
    diagnostics.flatMap((diagnostic) =>
      diagnostic.source === "stateward" && typeof diagnostic.code === "string"
        ? [diagnostic.code]
        : [],
    ),
  );
  return [...ruleIds].map((ruleId) => ({
    title: `Explain ${ruleId}`,
    kind: CodeActionKind.QuickFix,
    command: { title: `Explain ${ruleId}`, command: EXPLAIN_COMMAND, arguments: [ruleId] },
  }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wires the stateward language server to `connection`. The caller starts listening. The returned
 * function stops the server's timers (also done on shutdown); call it before disposing the connection.
 */
export function startServer(
  connection: Connection,
  {
    idleMs = ENGINE_IDLE_MS,
    cacheDir = (project) => defaultCacheDir(project, process.env),
    saveMs = DISK_SAVE_MS,
  }: {
    /** How long a nested config's engine waits, with none of its files open, before it stops. */
    idleMs?: number;
    /** The results cache folder of a project, as the CLI finds it; undefined for none. */
    cacheDir?: (project: string) => string | undefined;
    /** The least time between two writes of a config's results cache. */
    saveMs?: number;
  } = {},
): () => void {
  const documents = new TextDocuments(TextDocument);
  /** The workspace folders; undefined until the client has initialized. */
  let folders: readonly string[] = [];
  /** The client lets the server add file watchers (`SCRIPT_GLOB`). */
  let watchScripts = false;
  /** The client can be told to ask for inline hints again (after a check, a settings change). */
  let refreshHints = false;
  /** The client answers `workspace/configuration`. */
  let canPullSettings = false;
  /** The client lets the server ask to be told when settings change. */
  let watchSettings = false;
  let locator = createConfigLocator(folders);
  /** One engine per config file, by its path. */
  const engines = new Map<string, Engine>();
  const errorGate = createErrorGate();
  let stopped = false;

  const overlays = (): Map<string, string> =>
    new Map(
      documents
        .all()
        .filter((document) => isSyncedFile(document.uri))
        .map((document) => [fileURLToPath(document.uri), document.getText()]),
    );

  const openVersions = (): Map<string, number> =>
    new Map(
      documents
        .all()
        .filter((document) => isTypeScriptFile(document.uri))
        .map((document) => [toTypeScriptPath(fileURLToPath(document.uri)), document.version]),
    );

  /** The engine of the config `file` belongs to, if it runs. */
  const engineOf = (file: string): Engine | undefined => {
    const configFile = locator.configOf(file);
    return configFile === undefined ? undefined : engines.get(configFile);
  };

  /**
   * Whether `engine` shows the findings of `file`: the file's own config does. A file no config in
   * the workspace claims (a shared folder outside it) is shown by whichever engine checked it.
   */
  const shows = (engine: Engine, file: string): boolean => {
    const owner = locator.configOf(file);
    return owner === undefined || owner === engine.configFile;
  };

  /** The config's name in log lines, only when several configs run (one is the usual case). */
  const suffix = (engine: Engine): string => {
    if (engines.size < 2) return "";
    const folder = folderOf(engine.configFile, folders) ?? engine.cwd;
    return ` (${displayPath(folder, engine.configFile)})`;
  };

  const fileMapper = (open: ReadonlyMap<string, string>): FileMapper => {
    const indexes = new Map<string, ReturnType<typeof buildLineIndex>>();
    return {
      uriOf: (file) => pathToFileURL(file).href,
      textOf: (file) => open.get(file) ?? readFileSync(file, "utf8"),
      indexOf: (file) => {
        const cached = indexes.get(file);
        if (cached !== undefined) return cached;
        const index = buildLineIndex(open.get(file) ?? readFileSync(file, "utf8"));
        indexes.set(file, index);
        return index;
      },
    };
  };

  /** The diagnostics by URI, and the fix sites by file, for `findings` (hidden counts come first in a file). */
  const render = (
    findings: readonly Finding[],
    hidden: readonly HiddenFindings[],
    open: ReadonlyMap<string, string>,
    baselined: ReadonlySet<Finding> = new Set(),
  ): { byUri: Map<string, Diagnostic[]>; sites: Map<string, PendingSite[]> } => {
    const files = fileMapper(open);
    const byUri = new Map<string, Diagnostic[]>();
    const sites = new Map<string, PendingSite[]>();
    for (const finding of findings) {
      // `unknowns: "off"` leaves places not checked out of the editor; the log line counts them.
      if (finding.kind === "unknown" && finding.shown === "off") continue;
      const uri = files.uriOf(finding.location.file);
      const diagnostic = toDiagnostic(finding, files, baselined.has(finding));
      byUri.set(uri, [...(byUri.get(uri) ?? []), diagnostic]);
      const fixable = finding.kind === "problem" && finding.fixes.length > 0;
      const ignore = toIgnoreAction(finding, diagnostic, files);
      if (fixable || ignore !== undefined) {
        const key = toTypeScriptPath(finding.location.file);
        sites.set(key, [
          ...(sites.get(key) ?? []),
          {
            range: diagnostic.range,
            finding,
            diagnostic,
            files,
            ...(ignore === undefined ? {} : { ignore }),
          },
        ]);
      }
    }
    const notShown = new Map<string, Diagnostic[]>();
    for (const entry of hidden) {
      const uri = files.uriOf(entry.file);
      notShown.set(uri, [...(notShown.get(uri) ?? []), toHiddenDiagnostic(entry)]);
    }
    for (const [uri, diagnostics] of notShown) {
      byUri.set(uri, [...diagnostics, ...(byUri.get(uri) ?? [])]);
    }
    return { byUri, sites };
  };

  /** One popup and one log entry for a check that threw; the diagnostics already shown stay. */
  const reportFailure = (error: unknown): void => {
    showError(checkErrorText(error));
    connection.console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  };

  /**
   * The whole project of one config: every rule, every file. Replaces its diagnostics. It checks in
   * slices, so edits and requests are answered meanwhile; an edit cancels it (`run.cancelled`), as
   * does a config that stopped or was reloaded, and then nothing is published.
   */
  const fullPass = async (
    engine: Engine,
    run: FullRun,
    progress: ProgressReporter,
  ): Promise<void> => {
    const { state } = engine;
    if (state.kind !== "ready") return;
    clearTimeout(engine.fastTimer);
    engine.pendingFast.clear();
    const open = overlays();
    let reported = 0;
    try {
      const outcome = await state.checker.checkInSlices(open, {
        cancelled: () =>
          run.cancelled ||
          stopped ||
          engines.get(engine.configFile) !== engine ||
          engine.state !== state,
        progress: (at) => {
          const now = performance.now();
          if (now - reported < PROGRESS_REPORT_MS) return;
          reported = now;
          progress.report(progressMessage(at), progressPercentage(at));
        },
      });
      const longest = longestStepLine(outcome.longest, engine.cwd);
      if (longest !== undefined && !stopped) {
        connection.console.log(`stateward: ${longest}${suffix(engine)}`);
      }
      if (outcome.kind === "cancelled") {
        if (!stopped) {
          connection.console.log(
            `stateward: project check stopped by a newer change${suffix(engine)}`,
          );
        }
        return;
      }
      const raw = outcome.result;
      const pass = layBaseline(
        state.config,
        raw,
        activeRuleIds(state.config, { kind: "configured" }),
        open,
      );
      const result = pass.fresh;
      const { byUri, sites } = render(
        pass.findings.filter((finding) => shows(engine, finding.location.file)),
        pass.hidden.filter((entry) => shows(engine, entry.file)),
        open,
        pass.baselined,
      );
      for (const uri of engine.published) {
        if (!byUri.has(uri)) void connection.sendDiagnostics({ uri, diagnostics: [] });
      }
      for (const [uri, diagnostics] of byUri) void connection.sendDiagnostics({ uri, diagnostics });
      engine.published = new Set(byUri.keys());
      engine.fixSites = sites;
      engine.fixVersions = openVersions();
      errorGate.recovered();
      connection.console.log(`${fullPassLine(result)}${suffix(engine)}`);
      void connection.sendNotification(STATUS_NOTIFICATION, {
        ...statusReport(state.config, result, pass.baselined.size),
        configFile: engine.configFile,
      });
      // The hints come from this pass's summaries.
      if (refreshHints) connection.languages.inlayHint.refresh().catch(logUnexpected);
      saveSoon(engine);
    } catch (error) {
      reportFailure(error);
    }
  };

  /** Opens a progress if the client advertised them; the library answers a no-op otherwise. */
  const openProgress = async (): Promise<ProgressReporter> => {
    let timeout: NodeJS.Timeout | undefined;
    const silent = new Promise<ProgressReporter>((resolve) => {
      timeout = setTimeout(() => {
        resolve(SILENT_PROGRESS);
      }, PROGRESS_OPEN_TIMEOUT_MS);
    });
    const opened = connection.window
      .createWorkDoneProgress()
      .then((reporter): ProgressReporter => ({
        begin: (title) => {
          reporter.begin(title, 0);
        },
        // A pass still unwinding after the server stopped must not write to a closed connection.
        report: (message, percentage) => {
          if (!stopped) reporter.report(percentage, message);
        },
        done: () => {
          if (!stopped) reporter.done();
        },
      }));
    try {
      return await Promise.race([opened, silent]);
    } finally {
      clearTimeout(timeout);
    }
  };

  const isCancelled = (run: FullRun): boolean => run.cancelled;
  const quietProgress = (): Promise<ProgressReporter> => Promise.resolve(SILENT_PROGRESS);

  /** Stops the running full pass of `engine` at its next slice, if one runs. */
  const cancelFull = (engine: Engine): void => {
    if (engine.fullRun !== undefined) engine.fullRun.cancelled = true;
  };

  const runFull = async (engine: Engine): Promise<void> => {
    if (engine.state.kind !== "ready") return;
    if (engine.fullRun !== undefined) {
      // The newer pass supersedes the running one: it stops, and this one runs when it has.
      engine.fullRun.cancelled = true;
      engine.fullAgain = true;
      return;
    }
    const run: FullRun = { cancelled: false };
    engine.fullRun = run;
    void connection.sendNotification(CHECKING_NOTIFICATION, {
      configFile: engine.configFile,
      checking: true,
    });
    try {
      // Only the first pass of a config is waited for; later ones show in the status bar alone.
      const open = engine.firstFullDone ? quietProgress : openProgress;
      await withProgress(open, PROGRESS_TITLE, async (progress) => {
        // Let the progress reach the client before the first slice.
        await new Promise<void>((resolve) => setImmediate(resolve));
        // A config that stopped while the progress opened is not checked any more.
        if (engines.get(engine.configFile) === engine && !run.cancelled) {
          await fullPass(engine, run, progress);
          if (!isCancelled(run)) engine.firstFullDone = true;
        }
      });
    } finally {
      engine.fullRun = undefined;
      if (!stopped) {
        void connection.sendNotification(CHECKING_NOTIFICATION, {
          configFile: engine.configFile,
          checking: false,
        });
      }
    }
    if (engine.fullAgain) {
      engine.fullAgain = false;
      void runFull(engine).catch(logUnexpected);
    }
  };

  /** The open files that changed: their own rules only, merged with the project rules' last findings. */
  const fastPass = (engine: Engine): void => {
    // Its findings would be older than this pass's: an edit already stopped it, this makes sure.
    cancelFull(engine);
    const files = [...engine.pendingFast];
    engine.pendingFast.clear();
    const { state } = engine;
    if (state.kind !== "ready") return;
    const { checker: editor, config } = state;
    const open = overlays();
    const targets = files.filter((file) => open.has(file));
    if (targets.length === 0) return;
    try {
      const result = editor.checkFiles(targets, open);
      for (const file of targets) {
        const merged = mergeFastPass({ file, fast: result });
        // Only the file rules ran: the project rules' entries are not matched here.
        const fileRules = new Set(
          [...activeRuleIds(config, { kind: "configured" })].filter(
            (id) => !editor.projectRuleIds.has(id),
          ),
        );
        const pass = layBaseline(
          config,
          { findings: merged.findings, hidden: [], stats: result.stats },
          fileRules,
          open,
        );
        const { byUri, sites } = render(pass.findings, pass.hidden, open, pass.baselined);
        const uri = pathToFileURL(file).href;
        const diagnostics = byUri.get(uri) ?? [];
        void connection.sendDiagnostics({ uri, diagnostics });
        if (diagnostics.length === 0) engine.published.delete(uri);
        else engine.published.add(uri);
        engine.fixSites.set(toTypeScriptPath(file), sites.get(toTypeScriptPath(file)) ?? []);
        const version = openVersions().get(toTypeScriptPath(file));
        if (version !== undefined) engine.fixVersions.set(toTypeScriptPath(file), version);
      }
      errorGate.recovered();
      connection.console.log(
        `${fastPassLine(
          targets.map((file) => displayPath(engine.cwd, file)),
          result,
        )}${suffix(engine)}`,
      );
    } catch (error) {
      reportFailure(error);
    }
  };

  /** A popup for `message`, unless it is the one shown last. */
  const showError = (message: string): void => {
    if (!errorGate.shouldShow(message)) return;
    void connection.sendNotification(ShowMessageNotification.type, {
      type: MessageType.Error,
      message,
    });
  };

  /** A warning popup for what the config should change though it still works (old rule ids). */
  const showWarnings = (warnings: readonly string[]): void => {
    if (warnings.length === 0) return;
    void connection.sendNotification(ShowMessageNotification.type, {
      type: MessageType.Warning,
      message: `stateward: ${warnings.join("\n")}`,
    });
  };

  const logUnexpected = (error: unknown): void => {
    connection.console.error(`stateward check failed unexpectedly: ${describe(error)}`);
  };

  /** A full pass of `engine` after `delay` ms of quiet; a later call restarts the wait. */
  const scheduleFull = (engine: Engine, delay: number): void => {
    clearTimeout(engine.fullTimer);
    engine.fullTimer = setTimeout(() => void runFull(engine).catch(logUnexpected), delay);
  };

  /** An edit of `file`: its fast pass soon, the full pass after a longer quiet. */
  const scheduleEdit = (engine: Engine, file: string): void => {
    // A running full pass reads the text before this edit: stop it, so the fast pass runs soon and
    // the full pass starts again after the pause.
    cancelFull(engine);
    engine.pendingFast.add(file);
    clearTimeout(engine.fastTimer);
    engine.fastTimer = setTimeout(() => {
      fastPass(engine);
    }, FAST_MS);
    scheduleFull(engine, FULL_MS);
  };

  const clearDiagnostics = (engine: Engine): void => {
    for (const uri of engine.published) void connection.sendDiagnostics({ uri, diagnostics: [] });
    engine.published = new Set();
    engine.fixSites = new Map();
    engine.fixVersions = new Map();
  };

  /** Writes the results cache of `engine` now if it holds anything not written yet. */
  const saveDisk = (engine: Engine): void => {
    clearTimeout(engine.saveTimer);
    engine.saveTimer = undefined;
    const { disk } = engine;
    if (disk?.cache.changed !== true) return;
    const failed = disk.save();
    engine.savedAt = performance.now();
    // The findings are right; only the next start is slower. A log line, not a popup.
    if (failed !== undefined) {
      connection.console.log(`stateward: could not save the cache: ${failed.message}`);
    }
  };

  /** After a full pass completed: the results cache is written, at most once per `saveMs`. */
  const saveSoon = (engine: Engine): void => {
    if (engine.disk?.cache.changed !== true || engine.saveTimer !== undefined) return;
    const wait = engine.savedAt === undefined ? 0 : engine.savedAt + saveMs - performance.now();
    if (wait <= 0) {
      saveDisk(engine);
      return;
    }
    engine.saveTimer = setTimeout(() => {
      engine.saveTimer = undefined;
      // A pass that runs now holds results it has not stored yet: the next complete one writes.
      if (engine.fullRun === undefined) saveDisk(engine);
    }, wait);
  };

  /**
   * The results cache of `engine`'s project, read from the CLI's file; undefined without a cache
   * folder. A missing, broken or other version's file is an empty cache (a cold start), never an
   * error. The implementation id is computed again: a reload may have loaded changed local code.
   */
  const openDisk = (engine: Engine): DiskCache | undefined => {
    const dir = cacheDir(engine.cwd);
    if (dir === undefined) return undefined;
    return openDiskCache(
      dir,
      engine.cwd,
      engine.configFile,
      resultsCacheLimit(process.env),
      computeImplementationId(engine.configFile),
    );
  };

  /** Loads the config of `engine` and replaces its checker; on failure nothing is checked until the config changes. */
  const loadEngine = async (engine: Engine): Promise<void> => {
    engine.generation += 1;
    const generation = engine.generation;
    engine.configImports = new Set(configLocalImports(engine.configFile).map(toTypeScriptPath));
    const loaded = await loadConfigFile(engine.configFile);
    if (generation !== engine.generation || engines.get(engine.configFile) !== engine) return;
    // The checker this replaces: what it computed is written, so a reload of the same code reads it.
    saveDisk(engine);
    engine.disk = undefined;
    if (!loaded.ok) {
      showError(`stateward: ${loaded.errors.join("\n")}`);
      engine.state = { kind: "unconfigured" };
      clearDiagnostics(engine);
      return;
    }
    showWarnings(loaded.value.warnings);
    const disk = openDisk(engine);
    engine.disk = disk;
    engine.savedAt = undefined;
    engine.state = {
      kind: "ready",
      config: loaded.value,
      // Uncapped: the baseline is laid over every finding, then the new ones are capped.
      checker: createChecker({
        config: loaded.value,
        cwd: engine.cwd,
        uncapped: true,
        ...(disk === undefined ? {} : { cache: disk.cache }),
      }),
    };
    scheduleFull(engine, DEBOUNCE_MS);
  };

  /** The engine of `configFile`, started now if it was not running. */
  const ensureEngine = (configFile: string, pinned: boolean): Engine => {
    const running = engines.get(configFile);
    if (running !== undefined) return running;
    const engine: Engine = {
      configFile,
      cwd: path.dirname(configFile),
      pinned,
      state: { kind: "loading" },
      generation: 0,
      fastTimer: undefined,
      fullTimer: undefined,
      idleTimer: undefined,
      pendingFast: new Set(),
      fullRun: undefined,
      fullAgain: false,
      firstFullDone: false,
      published: new Set(),
      fixSites: new Map(),
      fixVersions: new Map(),
      configImports: new Set(),
      disk: undefined,
      saveTimer: undefined,
      savedAt: undefined,
    };
    engines.set(configFile, engine);
    void loadEngine(engine).catch(logUnexpected);
    return engine;
  };

  /** Stops `engine`: its timers, its diagnostics, its checker. */
  const disposeEngine = (engine: Engine, why: string): void => {
    if (engines.get(engine.configFile) !== engine) return;
    clearTimeout(engine.fastTimer);
    clearTimeout(engine.fullTimer);
    clearTimeout(engine.idleTimer);
    engine.pendingFast.clear();
    cancelFull(engine);
    engine.generation += 1;
    saveDisk(engine);
    clearDiagnostics(engine);
    engines.delete(engine.configFile);
    connection.console.log(`stateward: stopped checking with ${engine.configFile}: ${why}`);
  };

  /** Whether a file of `engine`'s config is open in the editor. */
  const hasOpenFile = (engine: Engine): boolean =>
    documents
      .all()
      .some(
        (document) =>
          isTypeScriptFile(document.uri) &&
          locator.configOf(fileURLToPath(document.uri)) === engine.configFile,
      );

  /** A nested config with none of its files open stops after `idleMs`; opening one keeps it. */
  const watchIdle = (engine: Engine): void => {
    clearTimeout(engine.idleTimer);
    engine.idleTimer = undefined;
    if (engine.pinned || hasOpenFile(engine)) return;
    engine.idleTimer = setTimeout(() => {
      if (!hasOpenFile(engine)) disposeEngine(engine, "none of its files is open");
    }, idleMs);
  };

  /** The engine an open document belongs to, started if needed; undefined outside every config. */
  const engineForDocument = (uri: string): Engine | undefined => {
    if (!isSyncedFile(uri) || stopped) return undefined;
    const configFile = locator.configOf(fileURLToPath(uri));
    if (configFile === undefined) return undefined;
    const engine = ensureEngine(configFile, false);
    clearTimeout(engine.idleTimer);
    engine.idleTimer = undefined;
    return engine;
  };

  /** After a config appeared or went: start what open files and folders need, stop what is gone. */
  const reconcile = (): void => {
    locator.forget();
    for (const engine of [...engines.values()]) {
      if (!existsSync(engine.configFile)) disposeEngine(engine, "the config file was removed");
    }
    for (const configFile of locator.rootConfigs()) ensureEngine(configFile, true);
    for (const document of documents.all()) engineForDocument(document.uri);
    for (const engine of engines.values()) watchIdle(engine);
  };

  connection.onInitialize((params) => {
    watchScripts =
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    refreshHints = params.capabilities.workspace?.inlayHint?.refreshSupport === true;
    canPullSettings = params.capabilities.workspace?.configuration === true;
    watchSettings =
      params.capabilities.workspace?.didChangeConfiguration?.dynamicRegistration === true;
    folders = (params.workspaceFolders ?? []).map((folder) => fileURLToPath(folder.uri));
    locator = createConfigLocator(folders);
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        inlayHintProvider: true,
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite, FIX_ALL_KIND],
        },
        semanticTokensProvider: {
          legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] },
          full: true,
        },
      },
    };
  });

  connection.onInitialized(() => {
    if (watchSettings) {
      connection.client
        .register(DidChangeConfigurationNotification.type, { section: "stateward" })
        .catch(logUnexpected);
    }
    if (canPullSettings) pullSettings().catch(logUnexpected);
    // The editor watches TypeScript files; a config's local `.mjs` import is watched from here.
    if (watchScripts) {
      connection.client
        .register(DidChangeWatchedFilesNotification.type, {
          watchers: [{ globPattern: SCRIPT_GLOB }],
        })
        .catch(logUnexpected);
    }
    if (folders.length === 0) {
      connection.console.log("stateward: no workspace folder is open; not checking");
      return;
    }
    const roots = locator.rootConfigs();
    if (roots.length === 0) {
      connection.console.log(
        `stateward: no stateward.config found at the root of ${folders.join(", ")}; a file under a folder that has one is checked when you open it`,
      );
    }
    reconcile();
  });

  connection.onDidChangeWatchedFiles((params) => {
    const imported = new Set([...engines.values()].flatMap((engine) => [...engine.configImports]));
    const changes = params.changes
      .filter((change) => change.uri.startsWith("file:"))
      .map((change) => ({
        file: fileURLToPath(change.uri),
        kind: classifyChange(fileURLToPath(change.uri), imported),
      }));
    const configs = changes.filter((change) => change.kind === "config");
    const reload = new Set<Engine>();
    if (configs.length > 0) {
      reconcile();
      for (const { file } of configs) {
        const engine = engines.get(file);
        if (engine !== undefined) reload.add(engine);
      }
    }
    for (const { file, kind } of changes) {
      if (kind !== "config-import") continue;
      if (/\.m?js$/.test(file) && !reloadsLocalImports()) {
        // This Node cannot load an ES module afresh (no `module.register`): the old one stays.
        connection.console.log(
          `stateward: ${path.basename(file)} changed; reload the window to use it (this Node loads a config's JavaScript imports once per session)`,
        );
      }
      for (const engine of engines.values()) {
        if (engine.configImports.has(toTypeScriptPath(file))) reload.add(engine);
      }
    }
    for (const engine of reload) {
      // Just started by `reconcile` (a new config) or a changed one: load it from its new text.
      if (engine.state.kind !== "loading") void loadEngine(engine);
    }
    if (changes.some((change) => change.kind === "source")) {
      for (const engine of engines.values()) scheduleFull(engine, DEBOUNCE_MS);
    }
  });

  documents.onDidOpen((event) => {
    engineForDocument(event.document.uri);
  });
  documents.onDidChangeContent((event) => {
    const engine = engineForDocument(event.document.uri);
    if (engine === undefined) return;
    const file = fileURLToPath(event.document.uri);
    if (!isTypeScriptFile(event.document.uri)) {
      // An imported JSON file: no findings of its own, but the files that import it change, and
      // only the full pass checks those.
      cancelFull(engine);
      scheduleFull(engine, FULL_MS);
      return;
    }
    // Fixes hold offsets of the text before this edit: offer none until the fast pass recomputes them.
    engine.fixSites.delete(toTypeScriptPath(file));
    scheduleEdit(engine, file);
  });
  documents.onDidSave((event) => {
    const engine = engineForDocument(event.document.uri);
    if (engine === undefined) return;
    clearTimeout(engine.fullTimer);
    void runFull(engine).catch(logUnexpected);
  });
  documents.onDidClose((event) => {
    if (!isSyncedFile(event.document.uri)) return;
    const engine = engineOf(fileURLToPath(event.document.uri));
    if (engine === undefined) return;
    engine.pendingFast.delete(fileURLToPath(event.document.uri));
    scheduleFull(engine, DEBOUNCE_MS);
    watchIdle(engine);
  });

  /** The ready engines, in a fixed order (by config path). */
  const readyEngines = (): (Engine & { state: { kind: "ready" } })[] =>
    [...engines.values()]
      .filter(
        (engine): engine is Engine & { state: { kind: "ready" } } => engine.state.kind === "ready",
      )
      .sort((a, b) => (a.configFile < b.configFile ? -1 : a.configFile > b.configFile ? 1 : 0));

  /**
   * The engine a command means: the one of the file it names (`uri`, the editor's active file),
   * else the only one, else the first in a fixed order.
   */
  const engineForRequest = (
    params: unknown,
  ): (Engine & { state: { kind: "ready" } }) | undefined => {
    const given: unknown =
      typeof params === "object" && params !== null && "uri" in params ? params.uri : undefined;
    const uri = typeof given === "string" ? given : undefined;
    const ready = readyEngines();
    if (uri?.startsWith("file:") === true) {
      const configFile = guarded(() => locator.configOf(fileURLToPath(uri)));
      const found = ready.find((engine) => engine.configFile === configFile);
      if (found !== undefined) return found;
    }
    return ready[0];
  };

  connection.onRequest(EXPLAIN_REQUEST, async (params: unknown) => {
    try {
      const ready = readyEngines();
      if (ready.length === 0) return await answerExplain(undefined, params);
      // Every config's plugins may differ: the first that knows the rule answers.
      for (const engine of ready) {
        const answer = await answerExplain(engine.state.config, params);
        if (answer !== null) return answer;
      }
      return null;
    } catch (error) {
      if (error instanceof InvalidExplainParamsError) {
        return new ResponseError(ErrorCodes.InvalidParams, error.message);
      }
      throw error;
    }
  });

  /** Every rule over the project, like `stateward plan`: the plan needs the findings of rules that are not on yet. */
  const checkAll = (config: Config, cwd: string): CheckResult => {
    const open = overlays();
    const everything = { kind: "all" } as const;
    const raw = check({ config, cwd, overlays: open, rules: everything, uncapped: true });
    // Baselined findings do not count for the plan or hold `next` back.
    return layBaseline(config, raw, activeRuleIds(config, everything), open).fresh;
  };

  connection.onRequest(PLAN_REQUEST, (params: unknown): PlanAnswer | ResponseError => {
    const engine = engineForRequest(params);
    if (engine === undefined) return unavailable();
    try {
      return planAnswer(engine.state.config, checkAll(engine.state.config, engine.cwd));
    } catch (error) {
      return failedRequest(error);
    }
  });

  connection.onRequest<NextAnswer, undefined>(NEXT_REQUEST, (params: unknown) => {
    try {
      const anyway = parseNextParams(params);
      const engine = engineForRequest(params);
      if (engine === undefined) return unavailable();
      const { config } = engine.state;
      if (!config.rollout) return rolloutOffAnswer(path.basename(engine.configFile));
      const answer = applyNext(config, checkAll(config, engine.cwd), anyway);
      // The rollout file is not watched: the rules that are on changed, so check again.
      if (answer.kind === "turned-on") scheduleFull(engine, DEBOUNCE_MS);
      return answer;
    } catch (error) {
      if (error instanceof InvalidNextParamsError) {
        return new ResponseError(ErrorCodes.InvalidParams, error.message);
      }
      return failedRequest(error);
    }
  });

  connection.onRequest(RECHECK_REQUEST, async (): Promise<null> => {
    for (const engine of readyEngines()) {
      clearTimeout(engine.fullTimer);
      await runFull(engine);
    }
    return null;
  });

  /**
   * The sites with their actions: each finding's fixes are tried first, and only those that compile
   * are offered. All fixes of the file are tried together, which costs
   * one program, about as much as one fix; a verdict is kept, so asking again is free.
   */
  const reviewSites = (engine: Engine, pending: readonly PendingSite[]): FixSite[] => {
    const checker = engine.state.kind === "ready" ? engine.state.checker : undefined;
    const fixable = pending.filter(
      (site) => site.finding.kind === "problem" && site.finding.fixes.length > 0,
    );
    const started = performance.now();
    const reviews =
      checker === undefined || fixable.length === 0
        ? []
        : (guarded(() => checker.reviewFixes(fixable.map((site) => site.finding))) ?? []);
    const elapsed = performance.now() - started;
    if (elapsed >= REVIEW_LOG_MS) {
      connection.console.log(
        `tried ${String(fixable.length)} findings' fixes in ${String(Math.round(elapsed))} ms`,
      );
    }
    const reviewed = new Map(fixable.map((site, i) => [site, reviews[i]?.finding] as const));
    return pending.map((site) => {
      const finding = reviewed.get(site);
      const form = finding?.kind === "problem" ? finding.fixes[0] : undefined;
      return {
        range: site.range,
        ...(form === undefined ? {} : { form }),
        // A fix that could not be tried (or the check threw) is not offered.
        actions: finding === undefined ? [] : toCodeActions(finding, site.diagnostic, site.files),
        ...(site.ignore === undefined ? {} : { extra: [site.ignore] }),
      };
    });
  };

  /**
   * Verifies the fixes "fix all" chose as one set, as they are applied together; undefined when no checker is ready, so the fixes are applied as they were offered.
   */
  const verifier = (
    engine: Engine | undefined,
    pending: readonly PendingSite[],
    sites: readonly FixSite[],
    uri: string,
  ): VerifyFixSet | undefined => {
    const checker = engine?.state.kind === "ready" ? engine.state.checker : undefined;
    if (checker === undefined) return undefined;
    return (chosen) => {
      const forms = chosen.flatMap((at) => sites[at]?.form ?? []);
      const files = pending[chosen[0] ?? 0]?.files;
      const review =
        forms.length === chosen.length ? guarded(() => checker.verifyFixSet(forms)) : undefined;
      if (review === undefined || files === undefined) {
        return { kept: chosen.map(() => false), edits: [] };
      }
      return { kept: review.kept, edits: toLspChanges(review.edits, files)[uri] ?? [] };
    };
  };

  connection.onCodeAction((params) => {
    const file = guarded(() => fileURLToPath(params.textDocument.uri));
    const engine = file === undefined ? undefined : engineOf(file);
    const key = file === undefined ? undefined : toTypeScriptPath(file);
    const pending =
      key === undefined || engine === undefined ? [] : (engine.fixSites.get(key) ?? []);
    const { only } = params.context;
    const actions: CodeAction[] = [];
    // The editor asks on every move of the cursor: fixes are tried only when one could be shown.
    const wanted =
      pending.some((site) => rangesIntersect(site.range, params.range)) ||
      (only !== undefined && kindWanted(only, FIX_ALL_KIND));
    const sites = engine === undefined || !wanted ? [] : reviewSites(engine, pending);
    const all = fixAllEdits(
      sites,
      params.textDocument.uri,
      verifier(engine, pending, sites, params.textDocument.uri),
    );
    const versionOf = (uri: string): number | null =>
      guarded(() => engine?.fixVersions.get(toTypeScriptPath(fileURLToPath(uri)))) ?? null;
    const fixAll: Omit<CodeAction, "title" | "kind"> = {
      edit: versionedEdit({ [params.textDocument.uri]: all.edits }, versionOf),
    };
    if (kindWanted(only, CodeActionKind.QuickFix)) {
      actions.push(
        ...sites
          .filter((site) => rangesIntersect(site.range, params.range))
          .flatMap((site) => [...site.actions, ...(site.extra ?? [])])
          .map((action) => versionedAction(action, versionOf)),
        ...explainActions(params.context.diagnostics),
      );
      if (all.count >= 2) {
        actions.push({
          title: "Fix all stateward problems in this file",
          kind: CodeActionKind.QuickFix,
          ...fixAll,
        });
      }
    }
    if (all.count >= 1 && kindWanted(only, FIX_ALL_KIND)) {
      actions.push({
        title: "Fix all stateward problems in this file",
        kind: FIX_ALL_KIND,
        ...fixAll,
      });
    }
    if (kindWanted(only, CodeActionKind.RefactorRewrite)) {
      actions.push(...refactorActions(params.textDocument.uri, params.range, versionOf));
    }
    return actions;
  });

  /**
   * Refactorings plugins offer on a range (no finding behind them), from the last check's
   * summaries and tried by core before they are offered. Only when the open text is the text that
   * check read, since the offsets are that text's.
   */
  const refactorActions = (
    uri: string,
    range: Range,
    versionOf: (uri: string) => number | null,
  ): CodeAction[] =>
    guarded(() => {
      const document = documents.get(uri);
      const editor = checkerOf(uri);
      if (document === undefined || editor === undefined) return [];
      const file = fileURLToPath(uri);
      const text = document.getText();
      if (editor.analysedText(file) !== text) return [];
      const index = buildLineIndex(text);
      const found = editor.refactors(
        file,
        offsetAt(index, range.start),
        offsetAt(index, range.end),
      );
      return found.map((action) =>
        versionedAction(
          {
            title: action.title,
            kind: CodeActionKind.RefactorRewrite,
            edit: {
              changes: {
                [uri]: action.edits.map((edit) => ({
                  range: toRange(index, edit.location),
                  newText: edit.newText,
                })),
              },
            },
          },
          versionOf,
        ),
      );
    }) ?? [];

  /** The checker of the config `uri`'s file belongs to, when it is ready. */
  const checkerOf = (uri: string): Checker | undefined => {
    const engine = guarded(() => engineOf(fileURLToPath(uri)));
    return engine?.state.kind === "ready" ? engine.state.checker : undefined;
  };

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    const editor = checkerOf(params.textDocument.uri);
    if (document === undefined || editor === undefined) return null;
    const markdown = guarded(() =>
      editor.hover(
        fileURLToPath(document.uri),
        offsetAt(buildLineIndex(document.getText()), params.position),
      ),
    );
    if (markdown === undefined || markdown.length === 0) return null;
    return { contents: { kind: MarkupKind.Markdown, value: markdown.join("\n\n---\n\n") } };
  });

  /** Which inline hints the editor's settings turn on (`stateward.inlayHints.*`). */
  let hintSettings: HintSettings = DEFAULT_HINT_SETTINGS;

  connection.languages.inlayHint.on((params) => {
    const document = documents.get(params.textDocument.uri);
    const editor = checkerOf(params.textDocument.uri);
    if (document === undefined || editor === undefined) return [];
    const hints = guarded(() => {
      const index = buildLineIndex(document.getText());
      const found = editor.inlayHints(fileURLToPath(document.uri), (kind) =>
        hintEnabled(hintSettings, kind),
      );
      return toInlayHints(found, index, {
        start: offsetAt(index, params.range.start),
        end: offsetAt(index, params.range.end),
      });
    });
    return hints ?? [];
  });

  /** The `stateward` settings, pulled from the client (`workspace/configuration`). */
  const pullSettings = async (): Promise<void> => {
    const section: unknown = await connection.workspace.getConfiguration("stateward");
    hintSettings = readHintSettings(section);
    if (refreshHints) await connection.languages.inlayHint.refresh();
  };

  connection.onDidChangeConfiguration((params) => {
    const pushed: unknown = params.settings;
    if (canPullSettings) {
      pullSettings().catch(logUnexpected);
    } else if (typeof pushed === "object" && pushed !== null && "stateward" in pushed) {
      // A client that pushes its settings (and cannot be asked for them).
      hintSettings = readHintSettings(pushed.stateward);
    }
  });

  connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);
    const editor = checkerOf(params.textDocument.uri);
    const empty = { data: [] };
    if (document === undefined || editor === undefined) return empty;
    const encoded = guarded(() =>
      encodeTokens(editor.tokens(fileURLToPath(document.uri)), buildLineIndex(document.getText())),
    );
    return encoded ?? empty;
  });

  /** Stops the timers: one that fires after the connection is gone would write to a closed connection. */
  const stop = (): void => {
    stopped = true;
    for (const engine of engines.values()) {
      clearTimeout(engine.fastTimer);
      clearTimeout(engine.fullTimer);
      clearTimeout(engine.idleTimer);
      engine.pendingFast.clear();
      cancelFull(engine);
      // A load still running must not start a check after the stop.
      engine.generation += 1;
      saveDisk(engine);
    }
  };
  connection.onShutdown(stop);

  documents.listen(connection);
  return stop;

  /** The config is missing or cannot be loaded: the answer says so; the cause was already shown. */
  function unavailable(): ResponseError<undefined> {
    return new ResponseError(
      ErrorCodes.InvalidRequest,
      "stateward has no usable config for this folder; fix the config (see the Stateward output), then try again",
    );
  }

  /** A check that threw, as the error the client shows. */
  function failedRequest(error: unknown): ResponseError<undefined> {
    connection.console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return new ResponseError<undefined>(ErrorCodes.InternalError, checkErrorText(error));
  }

  /** A plugin's editor code must not take the server down: log it and answer nothing. */
  function guarded<T>(compute: () => T): T | undefined {
    try {
      return compute();
    } catch (error) {
      connection.console.error(`stateward editor request failed: ${describe(error)}`);
      return undefined;
    }
  }
}
