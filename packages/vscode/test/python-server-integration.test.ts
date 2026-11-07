import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import { afterEach, describe, expect, it } from "vitest";
import { EXPLAIN_COMMAND, EXPLAIN_REQUEST, ruleIdFromArgument } from "../src/explain.js";
import { STATUS_NOTIFICATION, parseStatus, type Status } from "../src/protocol.js";
import {
  locatePythonServer,
  missingServerMessage,
  probePythonServer,
  pythonServerArgs,
} from "../src/python-server.js";
import { routeFor } from "../src/routing.js";
import { statusView } from "../src/status.js";

/**
 * The real `py-stateward server`, driven the way the extension's Python client drives it: found
 * by the extension's lookup, started with its arguments in the folder, told the same capabilities
 * (work-done progress, dynamic file watchers) and the folder as its one workspace folder.
 *
 * The server is not part of this repository's install: `PY_STATEWARD_SERVER` names it, else the
 * workspace's debug build (`cd ../python && cargo build -p py-stateward-cli`), else PATH. Pyrefly
 * comes from `PY_STATEWARD_PYREFLY`, else python/.venv (`sh scripts/gate.sh` there sets it up).
 */
const repository = fileURLToPath(new URL("../../../..", import.meta.url));
const fixture = fileURLToPath(new URL("fixtures/python-app", import.meta.url));
const server = locatePythonServer({
  folder: fixture,
  configured:
    process.env.PY_STATEWARD_SERVER ??
    path.join(repository, "python", "target", "debug", "py-stateward"),
  platform: process.platform,
  pathVariable: process.env.PATH,
  exists: existsSync,
});
const venvPyrefly = path.join(repository, "python", ".venv", "bin", "pyrefly");
const pyrefly = process.env.PY_STATEWARD_PYREFLY ?? (existsSync(venvPyrefly) ? venvPyrefly : "");

const RULE = "unions/default-hides-cases";

type Diagnostic = {
  code?: string;
  source?: string;
  message: string;
  range: { start: { line: number; character: number } };
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function until<T>(what: string, find: () => T | undefined, ms = 60_000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      const found = find();
      if (found !== undefined) resolve(found);
      else if (Date.now() - started > ms) reject(new Error(`timed out waiting for ${what}`));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

describe("a missing Python server", () => {
  it("is not found, does not run, and gives the one install message", async () => {
    const folder = path.join(tmpdir(), "stateward-no-such-project");
    const nowhere = path.join(folder, ".venv", "bin", "py-stateward");
    expect(
      locatePythonServer({
        folder,
        configured: "",
        platform: process.platform,
        pathVariable: "",
        exists: existsSync,
      }),
    ).toBe(undefined);
    expect(await probePythonServer(nowhere)).toEqual({ kind: "missing" });
    expect(missingServerMessage("app", { kind: "missing" })).toContain(
      "`uv add --dev py-stateward` or `pip install py-stateward`",
    );
  });
});

describe.skipIf(server === undefined)(
  `the real py-stateward server (${server?.command ?? "not built: set PY_STATEWARD_SERVER"})`,
  () => {
    it("reports a match's hidden cases, hovers with the explain link, explains, and sends the status", async () => {
      if (server === undefined) return;
      expect(await probePythonServer(server.command)).toMatchObject({ kind: "ok" });

      const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "stateward-python-")));
      cleanups.push(() => {
        rmSync(folder, { recursive: true, force: true });
      });
      cpSync(fixture, folder, { recursive: true });
      const file = path.join(folder, "status.py");
      const uri = pathToFileURL(file).href;

      const child: ChildProcess = spawn(
        server.command,
        pythonServerArgs({ pyrefly, checkerProcesses: 1 }),
        { cwd: folder, stdio: ["pipe", "pipe", "pipe"] },
      );
      cleanups.push(() => child.kill());
      if (child.stdout === null || child.stdin === null) throw new Error("no pipes to the server");
      const connection: MessageConnection = createMessageConnection(
        new StreamMessageReader(child.stdout),
        new StreamMessageWriter(child.stdin),
      );
      cleanups.push(() => {
        connection.dispose();
      });

      const diagnostics = new Map<string, readonly Diagnostic[]>();
      let status: Status | undefined;
      connection.onNotification(
        "textDocument/publishDiagnostics",
        (params: { uri: string; diagnostics: Diagnostic[] }) => {
          diagnostics.set(params.uri, params.diagnostics);
        },
      );
      connection.onNotification(STATUS_NOTIFICATION, (params: unknown) => {
        status = parseStatus(params);
      });
      // What the language client answers: the server's own file watchers, and its progress.
      connection.onRequest("client/registerCapability", () => null);
      connection.onRequest("window/workDoneProgress/create", () => null);
      connection.onNotification("window/logMessage", () => undefined);
      connection.listen();

      await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(folder).href,
        workspaceFolders: [{ uri: pathToFileURL(folder).href, name: "python-app" }],
        capabilities: {
          window: { workDoneProgress: true },
          workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
        },
      });
      await connection.sendNotification("initialized", {});
      await connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: "python", version: 1, text: readFileSync(file, "utf8") },
      });

      // A diagnostic: the `case _` that hides two members of the enum.
      const finding = await until("the match finding", () =>
        diagnostics.get(uri)?.find((diagnostic) => diagnostic.code === RULE),
      );
      expect(finding.source).toBe("stateward");
      expect(finding.message).toContain("Status.LOADING and Status.DONE");
      expect(finding.range.start).toEqual({ line: 13, character: 8 });

      // The hover's link runs the extension's explain command with the rule id.
      const hover = await connection.sendRequest<{ contents: { value: string } } | null>(
        "textDocument/hover",
        { textDocument: { uri }, position: finding.range.start },
      );
      const link = /\]\(command:([\w.]+)\?([^)]+)\)/.exec(hover?.contents.value ?? "");
      expect(link?.[1]).toBe(EXPLAIN_COMMAND);
      const argument: unknown = JSON.parse(decodeURIComponent(link?.[2] ?? "null"));
      const ruleId = ruleIdFromArgument(Array.isArray(argument) ? argument[0] : argument);
      expect(ruleId).toBe(RULE);

      // Explain goes to the server of the active Python document: this one.
      expect(routeFor({ fsPath: file, languageId: "python" }, [folder], true)).toEqual({
        kind: "python",
        folder,
      });
      const page = await connection.sendRequest<string | null>(EXPLAIN_REQUEST, { ruleId });
      expect(page).toContain(RULE);

      // The status item's view of this server, once the project check has answered.
      const shown = await until("the status", () => status);
      expect(shown.configFile).toBe(path.join(folder, "pyproject.toml"));
      expect(statusView(shown).text).toBe("$(error) Stateward: 1");

      await connection.sendRequest("shutdown");
      await connection.sendNotification("exit");
    }, 120_000);
  },
);
