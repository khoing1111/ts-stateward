import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
  ExecuteCommandRequest,
  LanguageClient,
  type DynamicFeature,
  type StaticFeature,
} from "vscode-languageclient/node";
import { EXPLAIN_COMMAND } from "./explain.js";
import {
  CHECKING_NOTIFICATION,
  STATUS_NOTIFICATION,
  parseChecking,
  parseStatus,
  type Status,
} from "./protocol.js";
import { PYTHON_WATCH_GLOBS, pyprojectOf, qualifyPythonFolder } from "./python-folders.js";
import {
  locatePythonServer,
  missingServerMessage,
  probePythonServer,
  pythonServerArgs,
  type PythonServerSettings,
} from "./python-server.js";

/**
 * A client that leaves the server's `executeCommandProvider` alone: py-stateward offers
 * `py-stateward.explain` for editors that only run commands, and a second Python folder's client
 * registering it again would fail to start. The extension explains through `stateward/explain`.
 */
class PythonLanguageClient extends LanguageClient {
  override registerFeature(feature: StaticFeature | DynamicFeature<unknown>): void {
    if (
      "registrationType" in feature &&
      feature.registrationType.method === ExecuteCommandRequest.method
    ) {
      return;
    }
    super.registerFeature(feature);
  }
}

/** One folder's running server and what it last said. */
type Running = {
  client: LanguageClient;
  output: vscode.LogOutputChannel;
  /** The file watchers that tell this server about `.py` and pyproject.toml changes. */
  watchers: readonly vscode.FileSystemWatcher[];
  /** The settings it started with: a change restarts it. */
  key: string;
  status: Status | undefined;
  checking: boolean;
};

export type PythonServerView = { status: Status | undefined; checking: boolean };

type ServerSetup = { serverPath: string } & PythonServerSettings;

function settingsOf(folder: vscode.WorkspaceFolder): ServerSetup & { enabled: boolean } {
  const settings = vscode.workspace.getConfiguration("stateward.python", folder.uri);
  return {
    enabled: settings.get<boolean>("enabled", false),
    serverPath: settings.get<string>("serverPath", ""),
    pyrefly: settings.get<string>("pyrefly", ""),
    checkerProcesses: settings.get<number>("checkerProcesses", 1),
  };
}

async function readPyproject(folder: string): Promise<string | undefined> {
  try {
    return await readFile(pyprojectOf(folder), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The Python language servers: one per workspace folder whose pyproject.toml has a
 * `[tool.stateward]` table or whose `stateward.python.enabled` is on, each limited to its folder
 * (documents, cwd, workspace folder) with its own output channel.
 */
export class PythonServers implements vscode.Disposable {
  private readonly running = new Map<string, Running>();
  /** Each folder's work in order: a start, a stop and a restart never overlap. */
  private readonly queues = new Map<string, Promise<void>>();
  /** The install message is shown once until "Restart the Python server" asks again. */
  private warned = false;

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly changed: () => void,
  ) {}

  /** The folders with a running server. */
  folders(): string[] {
    return [...this.running.keys()].sort();
  }

  client(folder: string): LanguageClient | undefined {
    return this.running.get(folder)?.client;
  }

  view(folder: string): PythonServerView | undefined {
    const running = this.running.get(folder);
    return running === undefined
      ? undefined
      : { status: running.status, checking: running.checking };
  }

  /** Looks at every workspace folder again; `restart` restarts the ones that keep a server. */
  refreshAll(restart = false): Promise<void> {
    if (restart) this.warned = false;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const open = new Set(folders.map((folder) => folder.uri.fsPath));
    const gone = [...this.running.keys()].filter((folder) => !open.has(folder));
    return Promise.all([
      ...gone.map((folder) => this.enqueue(folder, () => this.stop(folder))),
      ...folders.map((folder) => this.refresh(folder, restart)),
    ]).then(() => undefined);
  }

  /** Starts, keeps, restarts or stops the folder's server as its pyproject.toml and settings say. */
  refresh(folder: vscode.WorkspaceFolder, restart = false): Promise<void> {
    const dir = folder.uri.fsPath;
    return this.enqueue(dir, async () => {
      const settings = settingsOf(folder);
      const qualified = qualifyPythonFolder({
        pyproject: await readPyproject(dir),
        enabled: settings.enabled,
      });
      if (qualified.kind === "unreadable") {
        this.log.warn(
          `${pyprojectOf(dir)} is not valid TOML (${qualified.reason}); no Python server.`,
        );
      }
      if (qualified.kind !== "serve") {
        await this.stop(dir);
        return;
      }
      const key = JSON.stringify([
        settings.serverPath,
        settings.pyrefly,
        settings.checkerProcesses,
      ]);
      if (!restart && this.running.get(dir)?.key === key) return;
      await this.stop(dir);
      await this.start(folder, settings, key);
    });
  }

  private enqueue(folder: string, work: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(folder) ?? Promise.resolve();
    const next = previous.then(work).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.log.error(`The Python server of ${folder}: ${reason}`);
    });
    this.queues.set(folder, next);
    return next;
  }

  private async start(
    folder: vscode.WorkspaceFolder,
    settings: ServerSetup,
    key: string,
  ): Promise<void> {
    const dir = folder.uri.fsPath;
    if (settings.serverPath !== "" && !existsSync(settings.serverPath)) {
      this.log.warn(
        `stateward.python.serverPath is set to ${settings.serverPath}, which does not exist; ignoring it.`,
      );
    }
    const location = locatePythonServer({
      folder: dir,
      configured: settings.serverPath,
      platform: process.platform,
      pathVariable: process.env.PATH,
      exists: existsSync,
    });
    const check =
      location === undefined
        ? { kind: "missing" as const }
        : await probePythonServer(location.command);
    if (check.kind === "unreadable") {
      this.log.warn(`py-stateward --version printed "${check.output}", not a version.`);
    }
    if (location === undefined || check.kind === "missing" || check.kind === "unreadable") {
      this.missing(folder, { kind: "missing" });
      return;
    }
    if (check.kind === "too-old") {
      this.missing(folder, check);
      return;
    }
    this.log.info(
      `Using the ${location.kind} py-stateward ${check.version} for ${dir}: ${location.command}`,
    );

    const output = vscode.window.createOutputChannel(`Stateward (Python): ${folder.name}`, {
      log: true,
    });
    const watchers = PYTHON_WATCH_GLOBS.map((glob) =>
      vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob)),
    );
    const client = new PythonLanguageClient(
      `stateward-python-${dir}`,
      `Stateward (Python): ${folder.name}`,
      {
        command: location.command,
        args: pythonServerArgs(settings),
        options: { cwd: dir },
      },
      {
        documentSelector: [
          {
            scheme: "file",
            language: "python",
            pattern: `${dir.replaceAll("\\", "/")}/**/*`,
          },
        ],
        workspaceFolder: folder,
        outputChannel: output,
        synchronize: { fileEvents: watchers },
        // The hover's "Explain" link runs this command, and no other.
        markdown: { isTrusted: { enabledCommands: [EXPLAIN_COMMAND] } },
      },
    );
    const running: Running = {
      client,
      output,
      watchers,
      key,
      status: undefined,
      checking: false,
    };
    client.onNotification(STATUS_NOTIFICATION, (params: unknown) => {
      const status = parseStatus(params);
      if (status === undefined) {
        output.warn(`Ignoring a ${STATUS_NOTIFICATION} the extension does not understand.`);
        return;
      }
      running.status = status;
      this.changed();
    });
    client.onNotification(CHECKING_NOTIFICATION, (params: unknown) => {
      const update = parseChecking(params);
      if (update === undefined) {
        output.warn(`Ignoring a ${CHECKING_NOTIFICATION} the extension does not understand.`);
        return;
      }
      running.checking = update.checking;
      this.changed();
    });
    client.onDidChangeState(() => {
      this.changed();
    });
    this.running.set(dir, running);
    this.changed();
    try {
      await client.start();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      output.error(`The server did not start: ${reason}`);
      this.log.error(`The Python server of ${dir} did not start: ${reason}`);
    }
  }

  private missing(
    folder: vscode.WorkspaceFolder,
    problem: { kind: "missing" } | { kind: "too-old"; version: string },
  ): void {
    const message = missingServerMessage(folder.name, problem);
    this.log.warn(message);
    if (this.warned) return;
    this.warned = true;
    void vscode.window.showWarningMessage(message);
  }

  private async stop(folder: string): Promise<void> {
    const running = this.running.get(folder);
    if (running === undefined) return;
    this.running.delete(folder);
    this.changed();
    try {
      if (running.client.needsStop()) await running.client.stop();
    } finally {
      for (const watcher of running.watchers) watcher.dispose();
      running.output.dispose();
    }
  }

  /** Stops every server; the extension's deactivate waits for it. */
  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.running.keys()].map((folder) => this.enqueue(folder, () => this.stop(folder))),
    );
  }

  dispose(): void {
    void this.stopAll();
  }
}
