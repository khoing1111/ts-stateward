import { existsSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import {
  EXPLAIN_COMMAND,
  EXPLAIN_REQUEST,
  EXPLAIN_SCHEME,
  explainPath,
  ruleIdFromArgument,
} from "./explain.js";
import {
  CHECKING_NOTIFICATION,
  NEXT_REQUEST,
  PLAN_REQUEST,
  RECHECK_REQUEST,
  STATUS_NOTIFICATION,
  parseChecking,
  parseNext,
  parsePlan,
  parseStatus,
  type Plan,
} from "./protocol.js";
import {
  SHOW_COVERS_COMMAND,
  SHOW_PROOF_PATH_COMMAND,
  placeListFrom,
  whereOf,
  type Place,
} from "./places.js";
import { PythonServers } from "./python-clients.js";
import { PYPROJECT, PYTHON_RESTART_COMMAND } from "./python-folders.js";
import { COMMANDS, actionItems, planItems, ruleItems } from "./quick-pick.js";
import { routeFor, type ActiveDocument } from "./routing.js";
import { locateServer } from "./server-location.js";
import {
  answerKey,
  decideSetup,
  detectPackageManager,
  planSetup,
  readAnswer,
  type SetupAnswer,
} from "./setup.js";
import {
  STATUS_COMMAND,
  WAITING_VIEW,
  checkingView,
  statusFor,
  statusViewFor,
  type StatusView,
} from "./status.js";
import type { Status } from "./protocol.js";
import { WATCH_GLOBS, folderWithConfig, hasStatewardConfig } from "./workspace-config.js";

let client: LanguageClient | undefined;
/** The Python servers, one per Python folder; set while the extension is active. */
let python: PythonServers | undefined;
let statusBar: vscode.StatusBarItem | undefined;
/** What the TypeScript server last said: the status of each config, the last one, and the configs being checked. */
const typeScriptStatus: {
  statuses: Map<string, Status>;
  last: Status | undefined;
  checking: Set<string>;
} = { statuses: new Map(), last: undefined, checking: new Set() };
/** A start is looking for a config: a second call returns, so two clients never start. */
let starting = false;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Stateward", { log: true });
  context.subscriptions.push(output);

  const bar = vscode.window.createStatusBarItem(
    "stateward.status",
    vscode.StatusBarAlignment.Left,
    -100,
  );
  bar.name = "Stateward";
  bar.command = STATUS_COMMAND;
  statusBar = bar;
  context.subscriptions.push(bar, vscode.window.onDidChangeActiveTextEditor(refreshStatus));

  const servers = new PythonServers(output, refreshStatus);
  python = servers;
  context.subscriptions.push(servers, ...registerPython(servers));

  context.subscriptions.push(
    ...registerExplain(output),
    ...registerPlaces(),
    ...registerAdoptionCommands(output),
    ...registerSetup(context, output),
  );

  // A config that appears later (written by `stateward init`) starts the checks without a reload.
  const configWatcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidCreate(() => {
      void startClient(context, output);
    }),
  );

  void startClient(context, output);
  void servers.refreshAll();
  void offerSetup(context, output);
}

const CONFIG_GLOB = "**/stateward.config.{ts,mts,js,mjs}";

/**
 * The folder of the config that decides which stateward the editor runs: one at a workspace
 * folder's root, else the first one deeper (a package of a monorepo, or an app below the opened
 * folder). The server serves every config below the opened folder, at any depth, each file by
 * its nearest config, so a nested config needs no "open that folder" notice;
 * the editor only starts from the app's own stateward when the app is what holds the config.
 */
async function configFolder(folders: readonly string[]): Promise<string | undefined> {
  const root = folderWithConfig(folders);
  if (root !== undefined) return root;
  const nested = await vscode.workspace.findFiles(CONFIG_GLOB, "**/node_modules/**", 1);
  const first = nested[0];
  return first === undefined ? undefined : path.dirname(first.fsPath);
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

/** Starts the language client when a workspace folder has a stateward config; does nothing twice. */
async function startClient(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
): Promise<void> {
  if (client !== undefined || starting) return;
  const folders = workspaceFolderPaths();
  // Set before the wait: a config created meanwhile would otherwise start a second client.
  starting = true;
  let workspaceDir: string | undefined;
  try {
    workspaceDir = await configFolder(folders);
  } finally {
    starting = false;
  }
  if (workspaceDir === undefined) {
    output.info("No stateward.config.{ts,mts,js,mjs} in the workspace; not starting.");
    return;
  }

  const configuredPath = vscode.workspace
    .getConfiguration("stateward")
    .get<string>("serverPath", "");
  if (configuredPath !== "" && !existsSync(configuredPath)) {
    output.warn(
      `stateward.serverPath is set to ${configuredPath}, which does not exist; ignoring it.`,
    );
  }
  const server = locateServer(
    workspaceDir,
    context.asAbsolutePath(path.join("dist", "server.cjs")),
    { path: configuredPath, exists: existsSync },
  );
  output.info(`Using the ${server.kind} language server: ${server.modulePath}`);

  const transport = { module: server.modulePath, transport: TransportKind.stdio };
  const watchers = WATCH_GLOBS.map((glob) => vscode.workspace.createFileSystemWatcher(glob));
  context.subscriptions.push(...watchers);

  const started = new LanguageClient(
    "stateward",
    "Stateward",
    { run: transport, debug: transport },
    {
      documentSelector: [
        { scheme: "file", language: "typescript" },
        { scheme: "file", language: "typescriptreact" },
        // A program can import JSON (`resolveJsonModule`): its unsaved text is synced too.
        { scheme: "file", language: "json" },
      ],
      outputChannel: output,
      synchronize: { fileEvents: watchers },
    },
  );
  client = started;
  const { statuses, checking } = typeScriptStatus;
  refreshStatus();
  started.onNotification(STATUS_NOTIFICATION, (params: unknown) => {
    const status = parseStatus(params);
    if (status === undefined) {
      output.warn(`Ignoring a ${STATUS_NOTIFICATION} the extension does not understand.`);
      return;
    }
    if (status.configFile !== undefined) statuses.set(status.configFile, status);
    typeScriptStatus.last = status;
    refreshStatus();
  });
  started.onNotification(CHECKING_NOTIFICATION, (params: unknown) => {
    const update = parseChecking(params);
    if (update === undefined) {
      output.warn(`Ignoring a ${CHECKING_NOTIFICATION} the extension does not understand.`);
      return;
    }
    if (update.checking) checking.add(update.configFile);
    else checking.delete(update.configFile);
    refreshStatus();
  });
  void started.start();
}

function activeDocument(): ActiveDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document?.uri.scheme === "file"
    ? { fsPath: document.uri.fsPath, languageId: document.languageId }
    : undefined;
}

/** The TypeScript server's view for the active file: the status of the nearest config. */
function typeScriptView(active: string | undefined): StatusView {
  const { statuses, last, checking } = typeScriptStatus;
  const status = statusFor(active, statuses, last);
  const label =
    statuses.size > 1 && status?.configFile !== undefined
      ? vscode.workspace.asRelativePath(status.configFile)
      : undefined;
  const view = statusViewFor(status, label);
  // Before the first status the config is unknown: any running check is the one shown.
  const running =
    status?.configFile === undefined ? checking.size > 0 : checking.has(status.configFile);
  return running ? checkingView(view) : view;
}

/** A Python folder's view; the tooltip names the folder when another server runs beside it. */
function pythonView(servers: PythonServers, folder: string): StatusView {
  const view = servers.view(folder);
  if (view === undefined) return WAITING_VIEW;
  const others = servers.folders().length > 1 || client !== undefined;
  const status = statusViewFor(
    view.status,
    others ? `Python: ${path.basename(folder)}` : undefined,
  );
  return view.checking ? checkingView(status) : status;
}

/** One status item: the server of the active editor's folder and language says what it shows. */
function refreshStatus(): void {
  if (statusBar === undefined) return;
  const active = activeDocument();
  const route = routeFor(active, python?.folders() ?? [], client !== undefined);
  if (route === undefined) {
    statusBar.hide();
    return;
  }
  const view =
    route.kind === "typescript"
      ? typeScriptView(active?.fsPath)
      : python === undefined
        ? WAITING_VIEW
        : pythonView(python, route.folder);
  statusBar.text = view.text;
  statusBar.tooltip = view.tooltip;
  statusBar.show();
}

/** The server that explains a rule: the active document's (Python or TypeScript). */
function explainingServer(): LanguageClient | undefined {
  const route = routeFor(activeDocument(), python?.folders() ?? [], client !== undefined);
  if (route === undefined) return undefined;
  return route.kind === "typescript" ? client : python?.client(route.folder);
}

/**
 * The Python servers follow the workspace: a folder added or removed, its pyproject.toml written
 * or changed, or a `stateward.python.*` setting changed (that folder's server restarts).
 */
function registerPython(servers: PythonServers): vscode.Disposable[] {
  const pyprojects = vscode.workspace.createFileSystemWatcher(`**/${PYPROJECT}`);
  const onPyproject = (uri: vscode.Uri): void => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    // Only the folder's own pyproject.toml decides; a nested project's does not.
    if (folder?.uri.fsPath === path.dirname(uri.fsPath)) {
      void servers.refresh(folder);
    }
  };
  return [
    pyprojects,
    pyprojects.onDidCreate(onPyproject),
    pyprojects.onDidChange(onPyproject),
    pyprojects.onDidDelete(onPyproject),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void servers.refreshAll();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (event.affectsConfiguration("stateward.python", folder.uri)) {
          void servers.refresh(folder);
        }
      }
    }),
    vscode.commands.registerCommand(PYTHON_RESTART_COMMAND, () => servers.refreshAll(true)),
  ];
}

/**
 * `stateward.explain <rule id>`: asks the server for the rule's explanation (the text of the
 * installed version, so it works offline) and shows it in the Markdown preview, from a read-only
 * document of the `stateward-explain:` scheme.
 */
function registerExplain(output: vscode.LogOutputChannel): vscode.Disposable[] {
  const explanations = new Map<string, string>();
  const changed = new vscode.EventEmitter<vscode.Uri>();
  const provider = vscode.workspace.registerTextDocumentContentProvider(EXPLAIN_SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent: (uri) => explanations.get(uri.path) ?? "",
  });
  const command = vscode.commands.registerCommand(EXPLAIN_COMMAND, async (argument: unknown) => {
    const ruleId = ruleIdFromArgument(argument);
    const server = explainingServer();
    if (ruleId === undefined || server === undefined) return;
    try {
      const markdown = await server.sendRequest<string | null>(EXPLAIN_REQUEST, { ruleId });
      if (markdown === null) {
        void vscode.window.showInformationMessage(`Stateward has no explanation for ${ruleId}.`);
        return;
      }
      const uri = vscode.Uri.from({ scheme: EXPLAIN_SCHEME, path: explainPath(ruleId) });
      explanations.set(uri.path, markdown);
      changed.fire(uri);
      await vscode.workspace.openTextDocument(uri);
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      output.error(`Explaining ${ruleId} failed: ${reason}`);
      void vscode.window.showErrorMessage(`Stateward could not explain ${ruleId}: ${reason}`);
    }
  });
  return [changed, provider, command];
}

/**
 * The guarantee lens ("2 readers proven · show") and "Show proof path": a list of places to jump
 * through. Moving through the list shows each place without leaving the list; choosing one opens it.
 */
function registerPlaces(): vscode.Disposable[] {
  const reveal = async (place: Place, preview: boolean): Promise<void> => {
    const { start, end } = place.range;
    const range = new vscode.Range(start.line, start.character, end.line, end.character);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(place.uri));
    await vscode.window.showTextDocument(document, {
      selection: range,
      preview: true,
      preserveFocus: preview,
    });
  };
  const show = (argument: unknown): void => {
    const list = placeListFrom(argument);
    if (list === undefined || list.places.length === 0) return;
    type Item = vscode.QuickPickItem & { place: Place };
    const items = list.places.map((place): Item => {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(place.uri));
      return { label: place.label, description: whereOf(place, folder?.uri.toString()), place };
    });
    const pick = vscode.window.createQuickPick<Item>();
    pick.title = list.title;
    pick.items = items;
    pick.matchOnDescription = true;
    pick.onDidChangeActive(([active]) => {
      if (active !== undefined) void reveal(active.place, true);
    });
    pick.onDidAccept(() => {
      const [chosen] = pick.selectedItems;
      pick.hide();
      if (chosen !== undefined) void reveal(chosen.place, false);
    });
    pick.onDidHide(() => {
      pick.dispose();
    });
    pick.show();
  };
  return [
    vscode.commands.registerCommand(SHOW_COVERS_COMMAND, show),
    vscode.commands.registerCommand(SHOW_PROOF_PATH_COMMAND, show),
  ];
}

const NOT_CHECKING =
  'Stateward is not checking this folder: it has no stateward config. Run "Stateward: Set up the project".';

/** Runs `work` with the client, or says there is none; a failure becomes one message, never a silent command. */
/** The active editor's file, so a command acts on that file's config in a monorepo. */
function activeFile(): { uri?: string } {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri?.scheme === "file" ? { uri: uri.toString() } : {};
}

function withClient(
  output: vscode.LogOutputChannel,
  what: string,
  work: (active: LanguageClient) => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (client === undefined) {
      void vscode.window.showInformationMessage(NOT_CHECKING);
      return;
    }
    try {
      await work(client);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      output.error(`${what} failed: ${reason}`);
      void vscode.window.showErrorMessage(`Stateward could not ${what}: ${reason}`);
    }
  };
}

/** The plan runs every rule over the project, which takes a moment: show that it is working. */
function fetchPlan(active: LanguageClient): Promise<Plan> {
  return Promise.resolve(
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Stateward: planning" },
      async () => parsePlan(await active.sendRequest<unknown>(PLAN_REQUEST, activeFile())),
    ),
  );
}

async function turnOnNext(active: LanguageClient, anyway: boolean): Promise<void> {
  const answer = parseNext(
    await active.sendRequest<unknown>(NEXT_REQUEST, { anyway, ...activeFile() }),
  );
  switch (answer.kind) {
    case "turned-on":
    case "all-on":
      void vscode.window.showInformationMessage(answer.message);
      return;
    case "rollout-off":
      void vscode.window.showInformationMessage(answer.message);
      return;
    case "not-checked":
      void vscode.window.showWarningMessage(answer.message);
      return;
    case "blocked": {
      const anywayLabel = "Turn it on anyway";
      const chosen = await vscode.window.showWarningMessage(answer.message, anywayLabel);
      if (chosen === anywayLabel) await turnOnNext(active, true);
      return;
    }
    case "failed":
      void vscode.window.showErrorMessage(answer.message);
      return;
    default: {
      const unreachable: never = answer.kind;
      return unreachable;
    }
  }
}

function registerAdoptionCommands(output: vscode.LogOutputChannel): vscode.Disposable[] {
  const explain = (ruleId: string): Thenable<unknown> =>
    vscode.commands.executeCommand(EXPLAIN_COMMAND, ruleId);
  return [
    vscode.commands.registerCommand(
      COMMANDS.plan,
      withClient(output, "show the rule plan", async (active) => {
        const plan = await fetchPlan(active);
        const picked = await vscode.window.showQuickPick(planItems(plan.rules), {
          title: plan.rollout
            ? `Rule plan (on: ${plan.enabled.length === 0 ? "none yet" : plan.enabled.join(", ")})`
            : "Rule plan (rollout is off, so every rule runs)",
          placeHolder: "Choose a rule to read why it matters",
          matchOnDetail: true,
        });
        if (picked !== undefined) await explain(picked.ruleId);
      }),
    ),
    vscode.commands.registerCommand(
      COMMANDS.next,
      withClient(output, "turn on the next rule", (active) => turnOnNext(active, false)),
    ),
    vscode.commands.registerCommand(
      COMMANDS.explain,
      withClient(output, "list the rules", async (active) => {
        const plan = await fetchPlan(active);
        const picked = await vscode.window.showQuickPick(ruleItems(plan.rules), {
          placeHolder: "Explain which rule?",
          matchOnDetail: true,
        });
        if (picked !== undefined) await explain(picked.ruleId);
      }),
    ),
    vscode.commands.registerCommand(
      COMMANDS.recheck,
      withClient(output, "check again", async (active) => {
        await active.sendRequest(RECHECK_REQUEST);
      }),
    ),
    vscode.commands.registerCommand(STATUS_COMMAND, async () => {
      const picked = await vscode.window.showQuickPick(actionItems(), {
        placeHolder: "Stateward",
      });
      if (picked !== undefined) await vscode.commands.executeCommand(picked.command);
    }),
  ];
}

function folderFacts(context: vscode.ExtensionContext, folder: string) {
  return {
    hasPackageJson: existsSync(path.join(folder, "package.json")),
    hasTsconfig: existsSync(path.join(folder, "tsconfig.json")),
    hasConfig: hasStatewardConfig([folder]),
    answer: readAnswer(context.workspaceState.get(answerKey(folder))),
  };
}

/** "Set up stateward for this project?", once per folder; the answer is remembered. */
async function offerSetup(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
): Promise<void> {
  for (const folder of workspaceFolderPaths()) {
    if (decideSetup(folderFacts(context, folder)).kind !== "offer") continue;
    // Remembered before asking: a message that is closed unanswered counts as "Not now".
    await context.workspaceState.update(answerKey(folder), "not-now" satisfies SetupAnswer);
    const labels = { setUp: "Set up", notNow: "Not now", never: "Never for this project" } as const;
    const chosen = await vscode.window.showInformationMessage(
      "Set up stateward for this project?",
      labels.setUp,
      labels.notNow,
      labels.never,
    );
    if (chosen === labels.never) {
      await context.workspaceState.update(answerKey(folder), "never" satisfies SetupAnswer);
    } else if (chosen === labels.setUp) {
      await context.workspaceState.update(answerKey(folder), "set-up" satisfies SetupAnswer);
      await setUpFolder(folder, output);
    }
    return;
  }
}

/** Runs `npx stateward init` in a terminal when stateward is installed there; otherwise says how to install it. Never installs. */
async function setUpFolder(folder: string, output: vscode.LogOutputChannel): Promise<void> {
  const installed = existsSync(path.join(folder, "node_modules", "stateward", "package.json"));
  const manager = detectPackageManager((file) => existsSync(path.join(folder, file)));
  const setup = planSetup(installed, manager);
  switch (setup.kind) {
    case "run-init": {
      output.info(`Running ${setup.command} in ${folder}`);
      const terminal = vscode.window.createTerminal({ name: "Stateward setup", cwd: folder });
      terminal.show();
      terminal.sendText(setup.command);
      return;
    }
    case "explain-install": {
      const copy = "Copy";
      const chosen = await vscode.window.showInformationMessage(setup.message, copy);
      if (chosen === copy) await vscode.env.clipboard.writeText(setup.command);
      return;
    }
    default: {
      const unreachable: never = setup;
      return unreachable;
    }
  }
}

function registerSetup(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMANDS.setup, async () => {
      const folders = workspaceFolderPaths();
      const only = folders.length === 1 ? folders[0] : undefined;
      const folder =
        only ??
        (await vscode.window.showQuickPick(folders, { placeHolder: "Set up which folder?" }));
      if (folder === undefined) {
        if (folders.length === 0) {
          void vscode.window.showInformationMessage(
            "Open a project folder first, then set up stateward.",
          );
        }
        return;
      }
      await setUpFolder(folder, output);
    }),
  ];
}

export async function deactivate(): Promise<void> {
  await Promise.all([client?.stop(), python?.stopAll()]);
}
