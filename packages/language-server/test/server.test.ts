import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
} from "vscode-jsonrpc/node";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { createConnection } from "vscode-languageserver/node";
import { afterEach, describe, expect, it } from "vitest";
import { baselineOf, check, loadConfig, writeBaseline } from "@stateward/core/internal";
import { FULL_MS, startServer } from "../src/server.js";

type PublishedDiagnostics = {
  uri: string;
  diagnostics: readonly { code?: string; severity?: number; source?: string; message?: string }[];
};

const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));
const themeFile = path.join(example, "src", "theme.tsx");
const themeUri = pathToFileURL(themeFile).href;
const themeText =
  'import { createContext } from "react";\nexport const ThemeContext = createContext<string>(null!);\n';

/** Scratch projects live inside the package so `@stateward/*` and `react` resolve from the repo. */
const scratchRoot = fileURLToPath(new URL("../.scratch", import.meta.url));

const disposers: (() => void)[] = [];
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type ServerOptions = NonNullable<Parameters<typeof startServer>[1]>;

function connect(
  workspace: string,
  folders: readonly string[] = [workspace],
  capabilities: object = {},
  options: ServerOptions = {},
): MessageConnection {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const server = createConnection(toServer, fromServer);
  // No results cache on disk unless a test gives one: the example's node_modules stays as it is.
  const stop = startServer(server, { cacheDir: () => undefined, ...options });
  server.listen();
  const client = createMessageConnection(
    new StreamMessageReader(fromServer),
    new StreamMessageWriter(toServer),
  );
  client.listen();
  disposers.push(() => {
    stop();
    client.dispose();
    server.dispose();
  });
  void client.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities,
    workspaceFolders: folders.map((folder) => ({ uri: pathToFileURL(folder).href, name: "ws" })),
  });
  return client;
}

async function start(workspace: string): Promise<MessageConnection> {
  const client = connect(workspace);
  await client.sendNotification("initialized", {});
  return client;
}

function rethrow(error: unknown): never {
  throw error;
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    jsx: "react-jsx",
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
  },
  include: ["src"],
});

/** A plugin whose one rule reports the first statement of every file, with a fix. */
const FIXING_CONFIG = [
  "const rule = {",
  '  kind: "file",',
  '  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
  "  check(ctx) {",
  "    const node = ctx.sourceFile.statements[0];",
  "    if (node === undefined) return;",
  "    const location = { file: ctx.file, start: node.getStart(), end: node.getEnd() };",
  '    const fix = { title: "Fix it", edits: [{ location, newText: "" }] };',
  '    ctx.report({ message: "m", hint: "h", node, fixes: [fix] });',
  "  },",
  "};",
  'export default { preset: "recommended", plugins: [{ name: "fixing", description: "d", rules: { always: rule } }] };',
  "",
].join("\n");

/** A plugin whose one rule reports every top-level statement, each with a fix that deletes it. */
const FIXING_ALL_CONFIG = FIXING_CONFIG.replace(
  'const node = ctx.sourceFile.statements[0];\n    if (node === undefined) return;\n    const location = { file: ctx.file, start: node.getStart(), end: node.getEnd() };\n    const fix = { title: "Fix it", edits: [{ location, newText: "" }] };\n    ctx.report({ message: "m", hint: "h", node, fixes: [fix] });',
  'for (const node of ctx.sourceFile.statements) {\n    const location = { file: ctx.file, start: node.getStart(), end: node.getEnd() };\n    const fix = { title: "Fix it", edits: [{ location, newText: "" }] };\n    ctx.report({ message: "m", hint: "h", node, fixes: [fix] });\n  }',
);

function configText(rules: string): string {
  return [
    'import { reactContext } from "@stateward/plugin-react-context";',
    `export default { preset: "recommended", plugins: [reactContext()], rules: ${rules} };`,
    "",
  ].join("\n");
}

const CLEAN_THEME = themeText.replace("<string>(null!)", "(0)");

/** A project with one finding: a context with a placeholder default. */
const PROJECT: Readonly<Record<string, string>> = {
  "tsconfig.json": TSCONFIG,
  "stateward.config.ts": configText("{}"),
  "src/theme.tsx": themeText,
};

function scratchProject(prefix: string, files: Readonly<Record<string, string>>): string {
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(path.join(scratchRoot, prefix));
  scratchDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

type Inbox = {
  client: MessageConnection;
  diagnostics: PublishedDiagnostics[];
  popups: string[];
  logs: string[];
  /** The `stateward/status` notifications, in order. */
  statuses: unknown[];
  /** The work-done progress notifications, as "begin <title>" and "end". */
  progress: string[];
  /** The `stateward/checking` notifications' `checking`, in order: true when a full pass starts. */
  checking: boolean[];
  /** Resolves once `done()` holds; re-evaluated on every notification, never on a timer. */
  until(done: () => boolean): Promise<void>;
};

/** Records what the server sends, from the first message on. */
function collect(client: MessageConnection): Inbox {
  const waiting: (() => void)[] = [];
  const inbox: Inbox = {
    client,
    diagnostics: [],
    popups: [],
    logs: [],
    statuses: [],
    progress: [],
    checking: [],
    until: (done) =>
      new Promise((resolve) => {
        const test = (): void => {
          if (done()) resolve();
          else waiting.push(test);
        };
        test();
      }),
  };
  const received = (): void => {
    for (const test of waiting.splice(0)) test();
  };
  client.onNotification("textDocument/publishDiagnostics", (params: PublishedDiagnostics) => {
    inbox.diagnostics.push(params);
    received();
  });
  client.onNotification("window/showMessage", (params: { message: string }) => {
    inbox.popups.push(params.message);
    received();
  });
  client.onNotification("window/logMessage", (params: { message: string }) => {
    // "longest step" is logged only when a step took 300 ms or more: a line that depends on how
    // fast the machine is, so it is not part of what these tests compare.
    if (params.message.includes("longest step")) return;
    inbox.logs.push(params.message);
    received();
  });
  client.onNotification("stateward/status", (params: unknown) => {
    inbox.statuses.push(params);
    received();
  });
  client.onNotification("stateward/checking", (params: { checking: boolean }) => {
    inbox.checking.push(params.checking);
    received();
  });
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onNotification("$/progress", (params: { value: { kind: string; title?: string } }) => {
    inbox.progress.push(
      params.value.kind === "begin" ? `begin ${params.value.title ?? ""}` : params.value.kind,
    );
    received();
  });
  return inbox;
}

/** Tells the server a file changed on disk, as the editor's file watcher does. */
async function touch(inbox: Inbox, file: string): Promise<void> {
  await inbox.client.sendNotification("workspace/didChangeWatchedFiles", {
    changes: [{ uri: pathToFileURL(file).href, type: 2 }],
  });
}

/** The next diagnostics published for `uri` (the example has findings in more than one file). */
function nextDiagnostics(
  client: MessageConnection,
  uri: string = themeUri,
  accept: (published: PublishedDiagnostics) => boolean = () => true,
): Promise<PublishedDiagnostics> {
  return new Promise((resolve) => {
    client.onNotification("textDocument/publishDiagnostics", (params: PublishedDiagnostics) => {
      if (params.uri === uri && accept(params)) resolve(params);
    });
  });
}

// Each test starts a real server that builds a TypeScript program for the example project, which
// takes a few seconds on a cold or busy machine; the 5 s default made these flaky.
describe("language server", { timeout: 20_000 }, () => {
  it("advertises hover, quickfixes and semantic tokens with the TokenType legend", async () => {
    const client = connect(example);
    const result: unknown = await client.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
      workspaceFolders: [],
    });
    expect(result).toMatchObject({
      capabilities: {
        hoverProvider: true,
        inlayHintProvider: true,
        codeActionProvider: {
          codeActionKinds: ["quickfix", "refactor.rewrite", "source.fixAll.stateward"],
        },
        semanticTokensProvider: {
          legend: { tokenTypes: ["class", "function", "variable", "type", "decorator", "keyword"] },
        },
      },
    });
  });

  it("publishes diagnostics for an opened document, then clears them after a fix", async () => {
    const client = await start(example);
    const first = nextDiagnostics(client);
    await client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: themeUri, languageId: "typescriptreact", version: 1, text: themeText },
    });
    const opened = await first;
    expect(opened.uri).toBe(themeUri);
    expect(opened.diagnostics).toMatchObject([
      { code: "react-context/fake-default-value", severity: 1, source: "stateward" },
    ]);

    // The fast pass and the full pass both publish the finding first; wait for the cleared one.
    const second = nextDiagnostics(client, themeUri, (p) => p.diagnostics.length === 0);
    await client.sendNotification("textDocument/didChange", {
      textDocument: { uri: themeUri, version: 2 },
      contentChanges: [{ text: themeText.replace("<string>(null!)", "(0)") }],
    });
    expect(await second).toEqual({ uri: themeUri, diagnostics: [] });
  });

  it("answers hover and semantic tokens with nothing when no plugin contributes", async () => {
    const client = await start(example);
    const published = nextDiagnostics(client);
    await client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: themeUri, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await published;
    const hover: unknown = await client.sendRequest("textDocument/hover", {
      textDocument: { uri: themeUri },
      position: { line: 1, character: 10 },
    });
    const tokens: unknown = await client.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: themeUri },
    });
    expect(hover).toBeNull();
    expect(tokens).toMatchObject({ data: [] });
  });

  it("logs one line and shows no popup when the folder has no config", async () => {
    const dir = scratchProject("ls-", {});
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.length > 0);
    expect(inbox.logs).toHaveLength(1);
    expect(inbox.logs[0]).toContain("no stateward.config");
    expect(inbox.popups).toEqual([]);
  });

  it("logs one line and shows no popup when no folder is open", async () => {
    const inbox = collect(connect(example, []));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.length > 0);
    expect(inbox.logs).toEqual(["stateward: no workspace folder is open; not checking"]);
    expect(inbox.popups).toEqual([]);
  });

  it("shows an error once, and again only after a successful check in between", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "tsconfig.json": "{ not json" });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.popups.length === 1);
    expect(inbox.popups[0]).toContain("invalid tsconfig");
    expect(inbox.popups[0]).toMatch(
      /\. Fix: fix the tsconfig errors above, then run stateward check again$/,
    );

    // The failed check logs after it shows (or skips) the popup: the second log means it ran.
    await touch(inbox, path.join(dir, "src", "theme.tsx"));
    await inbox.until(() => inbox.logs.length === 2);
    expect(inbox.popups).toHaveLength(1);

    writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
    await touch(inbox, path.join(dir, "src", "theme.tsx"));
    await inbox.until(() => inbox.diagnostics.some((entry) => entry.diagnostics.length > 0));

    writeFileSync(path.join(dir, "tsconfig.json"), "{ not json");
    await touch(inbox, path.join(dir, "src", "theme.tsx"));
    await inbox.until(() => inbox.popups.length === 2);
    expect(inbox.popups[1]).toBe(inbox.popups[0]);
  });

  it("explains a project with nothing to check, with the fix", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "tsconfig.json": '{ "include": ["nothing"] }',
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.popups.length === 1);
    expect(inbox.popups[0]).toMatch(/gives stateward no files to check\. Fix: point "tsconfig"/);
  });

  it("re-checks when a file that is not open changes on disk, ignoring node_modules", async () => {
    const dir = scratchProject("ls-", PROJECT);
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.diagnostics.length === 1);
    const extra = path.join(dir, "src", "extra.tsx");
    writeFileSync(extra, themeText);
    await touch(inbox, path.join(dir, "node_modules", "pkg", "index.ts"));
    await touch(inbox, extra);
    await inbox.until(() =>
      inbox.diagnostics.some((entry) => entry.uri === pathToFileURL(extra).href),
    );
    expect(
      inbox.diagnostics.find((entry) => entry.uri === pathToFileURL(extra).href)?.diagnostics,
    ).toHaveLength(1);
  });

  it("reloads the config when it changes, and clears diagnostics when the reload fails", async () => {
    const dir = scratchProject("ls-", PROJECT);
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.diagnostics.length === 1);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    const config = path.join(dir, "stateward.config.ts");

    writeFileSync(config, configText('{ "react-context/fake-default-value": "off" }'));
    await touch(inbox, config);
    await inbox.until(() => inbox.diagnostics.length === 2);
    expect(inbox.diagnostics[1]).toEqual({ uri: theme, diagnostics: [] });

    writeFileSync(config, configText("{}"));
    await touch(inbox, config);
    await inbox.until(() => inbox.diagnostics.length === 3);
    expect(inbox.diagnostics[2]?.diagnostics).toHaveLength(1);

    writeFileSync(config, "export default 3;\n");
    await touch(inbox, config);
    await inbox.until(() => inbox.diagnostics.length === 4);
    expect(inbox.diagnostics[3]).toEqual({ uri: theme, diagnostics: [] });
    expect(inbox.popups).toHaveLength(1);
    expect(inbox.popups[0]).toContain("must export the config");
  });

  it("reloads the config when a local file it imports changes", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "team.mjs": "export const rules = {};\n",
      "stateward.config.ts": [
        'import { reactContext } from "@stateward/plugin-react-context";',
        'import { rules } from "./team.mjs";',
        'export default { preset: "recommended", plugins: [reactContext()], rules };',
        "",
      ].join("\n"),
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.diagnostics.length === 1);
    expect(inbox.diagnostics[0]?.diagnostics).toHaveLength(1);
    const team = path.join(dir, "team.mjs");
    writeFileSync(team, 'export const rules = { "react-context/fake-default-value": "off" };\n');
    await touch(inbox, team);
    await inbox.until(() => inbox.diagnostics.length === 2);
    expect(inbox.diagnostics[1]).toEqual({
      uri: pathToFileURL(path.join(dir, "src", "theme.tsx")).href,
      diagnostics: [],
    });
  });

  it("re-checks from disk when a document is closed", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "src/theme.tsx": CLEAN_THEME });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await inbox.until(() => inbox.diagnostics.some((entry) => entry.diagnostics.length > 0));
    await inbox.client.sendNotification("textDocument/didClose", { textDocument: { uri: theme } });
    await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 0);
    expect(inbox.diagnostics.at(-1)?.uri).toBe(theme);
  });

  it("finds quick fixes for a URI that encodes a character the file path does not", async () => {
    const dir = scratchProject("@ls-", { ...PROJECT, "stateward.config.ts": FIXING_CONFIG });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const plain = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    const encoded = plain.replaceAll("@", "%40");
    expect(encoded).not.toBe(plain);
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: encoded, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await inbox.until(() => inbox.diagnostics.length > 0);
    const actions: unknown = await inbox.client.sendRequest("textDocument/codeAction", {
      textDocument: { uri: encoded },
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
      context: { diagnostics: [] },
    });
    expect(Array.isArray(actions) ? actions.length : 0).toBeGreaterThan(0);
  });

  it("answers a hover or semantic tokens request that throws with an empty result", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": [
        "const boom = () => { throw new Error('plugin exploded'); };",
        "export default { preset: 'recommended', plugins: [{ name: 'boom', description: 'd', rules: {}, editor: { hover: boom, tokens: boom } }] };",
        "",
      ].join("\n"),
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    const hover: unknown = await inbox.client.sendRequest("textDocument/hover", {
      textDocument: { uri: theme },
      position: { line: 1, character: 10 },
    });
    const tokens: unknown = await inbox.client.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: theme },
    });
    expect(hover).toBeNull();
    expect(tokens).toEqual({ data: [] });
    expect(inbox.logs.filter((line) => line.includes("plugin exploded"))).toHaveLength(2);
  });

  it("answers inlay hints from the plugins, only the kinds the settings leave on, as plain type labels", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": [
        "const inlayHints = ({ sourceFile }) => [",
        "  { offset: sourceFile.statements[0].getEnd(), kind: 'first', label: ': one', tooltip: 'why one' },",
        "  { offset: sourceFile.getEnd(), kind: 'second', label: 'two', paddingLeft: true },",
        "];",
        "export default { preset: 'recommended', plugins: [{ name: 'hints', description: 'd', rules: {}, editor: { inlayHints } }] };",
        "",
      ].join("\n"),
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    const ask = (): Promise<unknown> =>
      inbox.client.sendRequest("textDocument/inlayHint", {
        textDocument: { uri: theme },
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
      });
    expect(await ask()).toEqual([
      {
        position: { line: 0, character: themeText.indexOf("\n") },
        label: ": one",
        kind: 1,
        tooltip: { kind: "markdown", value: "why one" },
      },
      { position: { line: 2, character: 0 }, label: "two", kind: 1, paddingLeft: true },
    ]);
    await inbox.client.sendNotification("workspace/didChangeConfiguration", {
      settings: { stateward: { inlayHints: { first: false } } },
    });
    expect(await ask()).toEqual([
      { position: { line: 2, character: 0 }, label: "two", kind: 1, paddingLeft: true },
    ]);
    const narrow: unknown = await inbox.client.sendRequest("textDocument/inlayHint", {
      textDocument: { uri: theme },
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
    });
    expect(narrow).toEqual([]);
  });

  it("pulls the stateward settings from a client that answers workspace/configuration", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": [
        "const inlayHints = ({ sourceFile }) => [",
        "  { offset: sourceFile.getEnd(), kind: 'first', label: 'one' },",
        "  { offset: sourceFile.getEnd(), kind: 'second', label: 'two' },",
        "];",
        "export default { preset: 'recommended', plugins: [{ name: 'hints', description: 'd', rules: {}, editor: { inlayHints } }] };",
        "",
      ].join("\n"),
    });
    const client = connect(dir, [dir], { workspace: { configuration: true } });
    client.onRequest("workspace/configuration", () => [{ inlayHints: { first: false } }]);
    await client.sendNotification("initialized", {});
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    // The settings are pulled after `initialized`: ask until they have arrived.
    let labels: unknown[] = [];
    for (let attempt = 0; attempt < 50 && labels.length !== 1; attempt++) {
      const hints: unknown = await client.sendRequest("textDocument/inlayHint", {
        textDocument: { uri: theme },
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
      });
      labels = Array.isArray(hints) ? hints.map((hint: { label: unknown }) => hint.label) : [];
      if (labels.length !== 1) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(labels).toEqual(["two"]);
  });

  it("offers a plugin's refactoring as a rewrite action, only when it compiles", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": [
        "const codeActions = ({ file, start }) => [",
        "  { title: 'Add a note', edits: [{ location: { file, start, end: start }, newText: '// note\\n' }] },",
        "  { title: 'Break it', edits: [{ location: { file, start, end: start }, newText: 'const = ;\\n' }] },",
        "];",
        "export default { preset: 'recommended', plugins: [{ name: 'refactor', description: 'd', rules: {}, editor: { codeActions } }] };",
        "",
      ].join("\n"),
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await inbox.until(() => inbox.diagnostics.length > 0);
    const ask = (only: string[]): Promise<unknown> =>
      inbox.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: theme },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only },
      });
    expect(await ask(["refactor"])).toMatchObject([
      {
        title: "Add a note",
        kind: "refactor.rewrite",
        edit: {
          documentChanges: [
            {
              textDocument: { uri: theme },
              edits: [{ range: { start: { line: 0, character: 0 } }, newText: "// note\n" }],
            },
          ],
        },
      },
    ]);
    expect(await ask(["quickfix"])).toEqual([]);
  });

  it("publishes the edited file's findings from the fast pass, before the full pass runs", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "src/theme.tsx": CLEAN_THEME });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: CLEAN_THEME },
    });
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked 1 files")));
    const fullPasses = (): number => inbox.logs.filter((l) => /^checked \d+ files/.test(l)).length;
    const before = fullPasses();
    const seen = inbox.logs.length;

    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: themeText }],
    });
    const fastLine = (): string | undefined =>
      inbox.logs.slice(seen).find((line) => /^checked src[\\/]theme\.tsx in \d+ ms$/.test(line));
    await inbox.until(() => fastLine() !== undefined);
    expect(inbox.diagnostics.at(-1)?.diagnostics).toHaveLength(1);
    expect(fullPasses()).toBe(before);

    // The full pass follows after a longer quiet, and says so in one line.
    await inbox.until(() => fullPasses() === before + 1);
    expect(inbox.logs.at(-1)).toMatch(
      /^checked 1 files in \d+\.\d s: 0 errors, 0 warnings, 1 infos$/,
    );
  });

  it("runs the full pass at once when a document is saved", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "src/theme.tsx": CLEAN_THEME });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: CLEAN_THEME },
    });
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked 1 files")));
    const before = inbox.logs.length;
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: themeText }],
    });
    const started = performance.now();
    await inbox.client.sendNotification("textDocument/didSave", { textDocument: { uri: theme } });
    await inbox.until(() =>
      inbox.logs.slice(before).some((line) => line.startsWith("checked 1 files")),
    );
    expect(performance.now() - started).toBeLessThan(FULL_MS);
  });

  it("keeps the project rules' findings of a file while its fast pass runs", async () => {
    const config = [
      "const whole = {",
      '  kind: "project",',
      '  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },',
      "  summarize: () => 1,",
      "  check(summaries, ctx) {",
      "    for (const file of summaries.keys()) {",
      '      ctx.report({ message: "whole", hint: "h", location: { file, start: 0, end: 0 } });',
      "    }",
      "  },",
      "};",
      'export default { preset: "recommended", plugins: [{ name: "proj", description: "d", rules: { whole } }] };',
      "",
    ].join("\n");
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": config });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked 1 files")));
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: `${themeText}export const x = 1;\n` }],
    });
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked src")));
    expect(inbox.diagnostics.at(-1)).toMatchObject({
      uri: theme,
      diagnostics: [{ code: "proj/whole" }],
    });
  });

  it("reports progress around a full pass when the client supports it, and ends it when the check fails", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "tsconfig.json": "{ not json" });
    const inbox = collect(connect(dir, [dir], { window: { workDoneProgress: true } }));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.progress.length === 2);
    expect(inbox.progress).toEqual(["begin Stateward: checking project", "end"]);
    expect(inbox.popups).toHaveLength(1);
  });

  it("opens a progress for the first full pass only; a later pass after an edit runs quietly", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "src/theme.tsx": CLEAN_THEME });
    const inbox = collect(connect(dir, [dir], { window: { workDoneProgress: true } }));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.until(() => inbox.progress.at(-1) === "end");
    const first = [...inbox.progress];
    const fullPasses = (): number => inbox.logs.filter((l) => /^checked \d+ files/.test(l)).length;
    await inbox.until(() => fullPasses() === 1);
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: CLEAN_THEME },
    });
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: `${CLEAN_THEME}export const x = 1;\n` }],
    });
    await inbox.until(() => fullPasses() === 2);
    expect(first[0]).toBe("begin Stateward: checking project");
    expect(inbox.progress).toEqual(first);
  });

  it("reports no progress to a client that did not advertise it", async () => {
    const inbox = collect(connect(example));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked")));
    expect(inbox.progress).toEqual([]);
  });

  it("answers stateward/explain with the rule's markdown, null for an unknown rule, and an error for bad params", async () => {
    const inbox = collect(connect(example));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked")));
    const explain = (params: unknown): Promise<unknown> =>
      inbox.client.sendRequest("stateward/explain", params);
    const markdown = await explain({ ruleId: "react-context/fake-default-value" });
    expect(typeof markdown === "string" ? markdown : "").toMatch(
      /^# react-context\/fake-default-value/,
    );
    expect(await explain({ ruleId: "nope/nothing" })).toBeNull();
    await expect(explain({})).rejects.toThrow("expects { ruleId: string }");
  });

  it("offers Explain and fix-all code actions for stateward diagnostics", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": FIXING_ALL_CONFIG });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: themeText },
    });
    await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 2);
    const diagnostics = inbox.diagnostics.at(-1)?.diagnostics ?? [];
    const ask = async (only?: readonly string[]): Promise<readonly CodeActionShape[]> => {
      const answer: unknown = await inbox.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: theme },
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        context: { diagnostics, ...(only === undefined ? {} : { only }) },
      });
      return Array.isArray(answer)
        ? answer.flatMap((item: unknown) => (isAction(item) ? [item] : []))
        : [];
    };

    const quick = await ask(["quickfix"]);
    const titles = quick.map((action) => action.title);
    expect(titles).toContain("Explain fixing/always");
    expect(titles).toContain("Fix all stateward problems in this file");
    expect(quick.find((a) => a.title.startsWith("Explain"))?.command).toEqual({
      title: "Explain fixing/always",
      command: "stateward.explain",
      arguments: ["fixing/always"],
    });
    expect(titles.filter((title) => title.startsWith("Explain"))).toHaveLength(1);

    const [fixAll] = await ask(["source.fixAll"]);
    expect(fixAll?.kind).toBe("source.fixAll.stateward");
    const [change] = fixAll?.edit?.documentChanges ?? [];
    expect(change?.textDocument).toEqual({ uri: theme, version: 1 });
    expect(change?.edits.map((edit) => edit.range.start.line)).toEqual([0, 1]);
    const fix = quick.find((a) => a.title === "Fix it");
    expect(fix?.edit?.documentChanges?.[0]?.textDocument).toEqual({ uri: theme, version: 1 });

    // An edit makes every offset in those fixes stale: none is offered until the fast pass recomputes them.
    const fresh = nextDiagnostics(inbox.client, theme, (p) => p.diagnostics.length > 0);
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: `// a\n// b\n${themeText}` }],
    });
    expect(await ask(["source.fixAll"])).toEqual([]);
    expect((await ask(["quickfix"])).filter((a) => a.edit !== undefined)).toEqual([]);
    await fresh;
    const [after] = await ask(["source.fixAll"]);
    expect(after?.edit?.documentChanges?.[0]?.textDocument).toEqual({ uri: theme, version: 2 });
  });
});

/** A rule that reports the first statement with three fixes: one compiles, one does not, one has a second form that does. */
const CHECKED_FIXES_CONFIG = [
  "const rule = {",
  '  kind: "file",',
  '  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
  "  check(ctx) {",
  "    const node = ctx.sourceFile.statements[0];",
  "    if (node === undefined) return;",
  "    const at = (newText) => [{ location: { file: ctx.file, start: node.getEnd(), end: node.getEnd() }, newText }];",
  "    const fixes = [",
  '      { title: "Compiles", edits: at("\\nexport const one: number = 1;") },',
  '      { title: "Breaks", edits: at("\\nexport const two: string = 2;") },',
  '      { title: "First form", edits: at("\\nexport const three: string = 3;"),',
  '        alternatives: [{ title: "Second form", edits: at("\\nexport const three: number = 3;") }] },',
  "    ];",
  '    ctx.report({ message: "m", hint: "h", node, fixes });',
  "  },",
  "};",
  'export default { preset: "recommended", plugins: [{ name: "checked", description: "d", rules: { first: rule } }] };',
  "",
].join("\n");

describe("language server: fixes are tried before they are offered", { timeout: 20_000 }, () => {
  it("offers only the fixes that compile, each in its first form that does", async () => {
    const text = "export const x = 1;\n";
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": CHECKED_FIXES_CONFIG,
      "src/theme.tsx": text,
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text },
    });
    await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 1);
    const diagnostics = inbox.diagnostics.at(-1)?.diagnostics ?? [];
    const ask = async (): Promise<readonly string[]> => {
      const answer: unknown = await inbox.client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: theme },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        context: { diagnostics, only: ["quickfix"] },
      });
      return Array.isArray(answer)
        ? answer.flatMap((item: unknown) =>
            isAction(item) && item.edit !== undefined ? [item.title] : [],
          )
        : [];
    };
    expect(await ask()).toEqual(["Compiles", "Second form", "Ignore this case here"]);
    // Asked again, the kept verdicts answer the same.
    expect(await ask()).toEqual(["Compiles", "Second form", "Ignore this case here"]);

    // After an edit, the fast pass's findings are tried on the edited text.
    const seen = inbox.logs.length;
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: `export const x = 1;\nexport const y = 2;\n` }],
    });
    await inbox.until(() => inbox.logs.slice(seen).some((line) => line.startsWith("checked src")));
    expect(await ask()).toEqual(["Compiles", "Second form", "Ignore this case here"]);
    expect(inbox.logs.filter((line) => line.includes("failed"))).toEqual([]);
  });
});

describe("language server: ignore comments", { timeout: 20_000 }, () => {
  const file = "export const x = 1;\n";

  it("does not show a finding that an ignore comment covers", async () => {
    const text = `// stateward-ignore fixing/always: intended\n${file}`;
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": FIXING_CONFIG,
      "src/theme.tsx": text,
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text },
    });
    await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked 1 files")));
    expect(inbox.logs.find((line) => line.startsWith("checked 1 files"))).toContain("0 errors");
    expect(inbox.diagnostics.flatMap((entry) => entry.diagnostics)).toEqual([]);
  });

  it("offers Ignore this case here on a finding, and shows the missing reason once it is added", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": FIXING_CONFIG,
      "src/theme.tsx": file,
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: theme, languageId: "typescriptreact", version: 1, text: file },
    });
    await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 1);
    const diagnostics = inbox.diagnostics.at(-1)?.diagnostics ?? [];
    const answer: unknown = await inbox.client.sendRequest("textDocument/codeAction", {
      textDocument: { uri: theme },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      context: { diagnostics, only: ["quickfix"] },
    });
    const actions = Array.isArray(answer)
      ? answer.flatMap((item: unknown) => (isAction(item) ? [item] : []))
      : [];
    const ignore = actions.find((action) => action.title === "Ignore this case here");
    expect(ignore?.edit?.documentChanges?.[0]).toMatchObject({
      textDocument: { uri: theme, version: 1 },
      edits: [{ newText: "// stateward-ignore fixing/always: \n" }],
    });
    // Fix all never inserts ignores: a person decides each one.
    const all = actions.filter((action) => action.title.startsWith("Fix all"));
    expect(all).toEqual([]);

    const fresh = nextDiagnostics(inbox.client, theme, (p) => p.diagnostics.length > 0);
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: `// stateward-ignore fixing/always: \n${file}` }],
    });
    const shown = await fresh;
    expect(shown.diagnostics.map((d) => d.code)).toEqual(["stateward/ignore"]);
    expect(shown.diagnostics[0]?.message).toContain("does not say why");
  });
});

function isAction(item: unknown): item is CodeActionShape {
  return (
    typeof item === "object" && item !== null && "title" in item && typeof item.title === "string"
  );
}

type CodeActionShape = {
  title: string;
  kind?: string;
  command?: unknown;
  edit?: {
    documentChanges?: {
      textDocument: { uri: string; version: number | null };
      edits: { range: { start: { line: number } } }[];
    }[];
  };
};

/** A plugin of two rules, each reporting the first statement of every file; only `one` has a fix. */
function rolloutConfig(rollout: boolean): string {
  return [
    "const make = (fixes) => ({",
    '  kind: "file",',
    '  meta: { description: "protects a thing", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
    "  check(ctx) {",
    "    const node = ctx.sourceFile.statements[0];",
    "    if (node === undefined) return;",
    "    const location = { file: ctx.file, start: node.getStart(), end: node.getEnd() };",
    '    ctx.report({ message: "m", hint: "h", node, fixes: fixes ? [{ title: "Fix it", edits: [{ location, newText: "" }] }] : [] });',
    "  },",
    "});",
    'const plugin = { name: "fixing", description: "d", rules: { one: make(true), two: make(false) } };',
    `export default { preset: "recommended", plugins: [plugin], rollout: ${String(rollout)} };`,
    "",
  ].join("\n");
}

const NO_ROLLOUT_YET = { on: true, enabled: 0, total: 2 };

describe("language server: status and adoption", { timeout: 20_000 }, () => {
  it("sends the counts after a full pass; without rollout, rollout is off", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(false) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length > 0);
    expect(inbox.statuses[0]).toEqual({
      configFile: path.join(dir, "stateward.config.ts"),
      errors: 2,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: false, enabled: 0, total: 0 },
    });
  });

  it("shows baselined findings as hints, counts only the new ones, and says how many are baselined", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(false) });
    const loaded = await loadConfig(dir);
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    const found = check({ config: loaded.value, cwd: dir, uncapped: true });
    writeBaseline(
      loaded.value,
      baselineOf(found.findings, {
        configDir: dir,
        readText: (file) => readFileSync(file, "utf8"),
      }),
    );
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length > 0);
    expect(inbox.statuses[0]).toEqual({
      configFile: path.join(dir, "stateward.config.ts"),
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 2,
      rollout: { on: false, enabled: 0, total: 0 },
    });
    const shown = inbox.diagnostics.flatMap((entry) => entry.diagnostics);
    expect(shown).toHaveLength(2);
    expect(shown.every((diagnostic) => diagnostic.severity === 4)).toBe(true);
    expect(shown.every((diagnostic) => diagnostic.message?.startsWith("baselined: "))).toBe(true);
  });

  it("answers the plan with every rule, whatever is on", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(true) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length > 0);
    expect(inbox.statuses[0]).toEqual({
      configFile: path.join(dir, "stateward.config.ts"),
      errors: 0,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: NO_ROLLOUT_YET,
    });
    const plan: unknown = await inbox.client.sendRequest("stateward/plan");
    expect(plan).toMatchObject({
      rollout: true,
      enabled: [],
      rules: [
        { order: 1, ruleId: "fixing/one", findings: 1, fixable: 1, protects: "protects a thing" },
        { order: 2, ruleId: "fixing/two", findings: 1, fixable: 0 },
      ],
    });
  });

  it("turns rules on one at a time, refuses while one has findings, and moves on when asked", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(true) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length > 0);
    const rolloutFile = path.join(dir, "stateward.rollout.json");
    const enabled = (): unknown => JSON.parse(readFileSync(rolloutFile, "utf8"));

    const first: unknown = await inbox.client.sendRequest("stateward/next", {});
    expect(first).toEqual({
      kind: "turned-on",
      message:
        "on: fixing/one (1 finding, 1 fixable)\nprotects a thing\nrun stateward check to see them",
    });
    expect(enabled()).toEqual({ version: 1, enabled: ["fixing/one"] });
    await inbox.until(() => inbox.statuses.length === 2);
    expect(inbox.statuses[1]).toEqual({
      configFile: path.join(dir, "stateward.config.ts"),
      errors: 1,
      warnings: 0,
      infos: 0,
      baselined: 0,
      rollout: { on: true, current: { ruleId: "fixing/one", findings: 1 }, enabled: 1, total: 2 },
    });

    const refused: unknown = await inbox.client.sendRequest("stateward/next", {});
    expect(refused).toEqual({
      kind: "blocked",
      message:
        "`fixing/one` still has 1 finding; fix them, turn the next rule on anyway, or accept them with `stateward baseline` in a terminal.",
    });
    expect(enabled()).toEqual({ version: 1, enabled: ["fixing/one"] });

    const anyway: unknown = await inbox.client.sendRequest("stateward/next", { anyway: true });
    expect(anyway).toMatchObject({ kind: "turned-on" });
    expect(enabled()).toEqual({ version: 1, enabled: ["fixing/one", "fixing/two"] });

    const done: unknown = await inbox.client.sendRequest("stateward/next", { anyway: true });
    expect(done).toMatchObject({ kind: "all-on" });
  });

  it("says rollout is off for next, and refuses params of the wrong shape", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(false) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length > 0);
    const off: unknown = await inbox.client.sendRequest("stateward/next", {});
    expect(off).toMatchObject({ kind: "rollout-off" });
    expect(JSON.stringify(off)).toContain("rollout: true");
    await expect(inbox.client.sendRequest("stateward/next", { anyway: "yes" })).rejects.toThrow(
      "expects { anyway?: boolean }",
    );
  });

  it("reports a broken rollout file as a failed answer, not a crash", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "stateward.config.ts": rolloutConfig(true),
      "stateward.rollout.json": "{ nope",
    });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.popups.length > 0);
    const answer: unknown = await inbox.client.sendRequest("stateward/next", {});
    expect(answer).toMatchObject({ kind: "failed" });
    expect(JSON.stringify(answer)).toContain("stateward.rollout.json");
  });

  it("re-checks when the rollout file is written outside the editor (stateward next in a terminal)", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(true) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 1);
    const file = path.join(dir, "stateward.rollout.json");
    writeFileSync(file, JSON.stringify({ version: 1, enabled: ["fixing/one"] }));
    await touch(inbox, file);
    await inbox.until(() => inbox.statuses.length === 2);
    expect(inbox.statuses[1]).toMatchObject({
      errors: 1,
      rollout: { current: { ruleId: "fixing/one" }, enabled: 1 },
    });
  });

  it("checks again on request", async () => {
    const dir = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": rolloutConfig(false) });
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 1);
    await inbox.client.sendRequest("stateward/recheck");
    expect(inbox.statuses).toHaveLength(2);
  });

  it("answers plan and next with an error when the folder has no config", async () => {
    const dir = scratchProject("ls-", {});
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.length > 0);
    await expect(inbox.client.sendRequest("stateward/plan")).rejects.toThrow("no usable config");
    await expect(inbox.client.sendRequest("stateward/next", {})).rejects.toThrow(
      "no usable config",
    );
  });
});

describe("language server: several folders and configs", { timeout: 20_000 }, () => {
  /** The config files the statuses came from, in order. */
  const statusConfigs = (inbox: Inbox): string[] =>
    inbox.statuses.flatMap((status) =>
      typeof status === "object" && status !== null && "configFile" in status
        ? [String(status.configFile)]
        : [],
    );

  const openFile = async (inbox: Inbox, file: string): Promise<void> => {
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(file).href,
        languageId: "typescript",
        version: 1,
        text: readFileSync(file, "utf8"),
      },
    });
  };

  const diagnosticsOf = (inbox: Inbox, file: string): PublishedDiagnostics[] =>
    inbox.diagnostics.filter((entry) => entry.uri === pathToFileURL(file).href);

  it("checks every workspace folder that has a config, each with its own", async () => {
    const one = scratchProject("ls-", PROJECT);
    const two = scratchProject("ls-", { ...PROJECT, "stateward.config.ts": FIXING_CONFIG });
    const inbox = collect(connect(one, [one, two]));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 2);
    expect(statusConfigs(inbox).sort()).toEqual(
      [path.join(one, "stateward.config.ts"), path.join(two, "stateward.config.ts")].sort(),
    );
    const theme = (dir: string): string => path.join(dir, "src", "theme.tsx");
    expect(
      diagnosticsOf(inbox, theme(one))
        .at(-1)
        ?.diagnostics.map((d) => d.code),
    ).toEqual(["react-context/fake-default-value"]);
    expect(
      diagnosticsOf(inbox, theme(two))
        .at(-1)
        ?.diagnostics.map((d) => d.code),
    ).toEqual(["fixing/always"]);
    expect(inbox.logs.some((line) => line.includes("ignoring"))).toBe(false);
  });

  it("checks a file with the nearest config above it, starting that config when the file opens", async () => {
    const dir = scratchProject("ls-", {
      ...PROJECT,
      "packages/x/tsconfig.json": TSCONFIG,
      "packages/x/stateward.config.ts": FIXING_CONFIG,
      "packages/x/src/x.ts": "export const x = 1;\n",
    });
    const nested = path.join(dir, "packages", "x", "stateward.config.ts");
    const xFile = path.join(dir, "packages", "x", "src", "x.ts");
    const inbox = collect(connect(dir, [dir], {}, { idleMs: 50 }));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 1);
    // Only the folder's own config runs until a file of the nested one is opened.
    expect(statusConfigs(inbox)).toEqual([path.join(dir, "stateward.config.ts")]);
    expect(diagnosticsOf(inbox, xFile)).toEqual([]);

    await openFile(inbox, xFile);
    await inbox.until(() => statusConfigs(inbox).includes(nested));
    await inbox.until(() => (diagnosticsOf(inbox, xFile).at(-1)?.diagnostics.length ?? 0) > 0);
    expect(
      diagnosticsOf(inbox, xFile)
        .at(-1)
        ?.diagnostics.map((d) => d.code),
    ).toEqual(["fixing/always"]);

    // Closed, and nothing else of it open: it stops a while later, and takes its diagnostics away.
    await inbox.client.sendNotification("textDocument/didClose", {
      textDocument: { uri: pathToFileURL(xFile).href },
    });
    await inbox.until(() => inbox.logs.some((line) => line.includes("stopped checking")));
    expect(inbox.logs.find((line) => line.includes("stopped checking"))).toBe(
      `stateward: stopped checking with ${nested}: none of its files is open`,
    );
    expect(diagnosticsOf(inbox, xFile).at(-1)?.diagnostics).toEqual([]);
  });

  it("shows a file's findings only from its own config when two configs check it", async () => {
    // The root config checks the whole repository, packages/x included; packages/x has its own.
    const dir = scratchProject("ls-", {
      "tsconfig.json": JSON.stringify({ ...JSON.parse(TSCONFIG), include: ["packages"] }),
      "stateward.config.ts": FIXING_CONFIG.replace('message: "m"', 'message: "root"'),
      "packages/x/tsconfig.json": TSCONFIG,
      "packages/x/stateward.config.ts": FIXING_CONFIG,
      "packages/x/src/x.ts": "export const x = 1;\n",
    });
    const xFile = path.join(dir, "packages", "x", "src", "x.ts");
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 1);
    expect(diagnosticsOf(inbox, xFile)).toEqual([]);
    await openFile(inbox, xFile);
    await inbox.until(() => (diagnosticsOf(inbox, xFile).at(-1)?.diagnostics.length ?? 0) > 0);
    expect(
      diagnosticsOf(inbox, xFile).flatMap((entry) => entry.diagnostics.map((d) => d.message)),
    ).not.toContain("root");
  });

  it("checks a nested config when the folder's root has none", async () => {
    const dir = scratchProject("ls-", {
      "packages/x/tsconfig.json": TSCONFIG,
      "packages/x/stateward.config.ts": FIXING_CONFIG,
      "packages/x/src/x.ts": "export const x = 1;\n",
    });
    const xFile = path.join(dir, "packages", "x", "src", "x.ts");
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.logs.length > 0);
    expect(inbox.logs[0]).toContain("no stateward.config found at the root of");
    await openFile(inbox, xFile);
    await inbox.until(() => inbox.statuses.length > 0);
    expect(statusConfigs(inbox)).toEqual([path.join(dir, "packages", "x", "stateward.config.ts")]);
    expect(
      diagnosticsOf(inbox, xFile)
        .at(-1)
        ?.diagnostics.map((d) => d.code),
    ).toEqual(["fixing/always"]);
  });
});

/**
 * A project whose full pass is slow: its one file rule spends `SLOW_MS` on every file, of which
 * there are `SLOW_FILES`, and reports a file whose text has `BAD`.
 */
const SLOW_MS = 40;
const SLOW_FILES = 60;
const SLOW_CONFIG = [
  "const rule = {",
  '  kind: "file",',
  '  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
  "  check(ctx) {",
  `    const until = Date.now() + ${String(SLOW_MS)};`,
  "    while (Date.now() < until) { /* a slow rule */ }",
  "    const node = ctx.sourceFile.statements[0];",
  '    if (node === undefined || !ctx.sourceFile.text.includes("BAD")) return;',
  '    ctx.report({ message: "bad", hint: "h", node });',
  "  },",
  "};",
  'export default { preset: "recommended", plugins: [{ name: "slow", description: "d", rules: { rule } }] };',
  "",
].join("\n");

function slowProject(): string {
  const files: Record<string, string> = {
    "tsconfig.json": TSCONFIG,
    "stateward.config.ts": SLOW_CONFIG,
    "src/theme.tsx": "export const theme = 1;\n",
  };
  for (let i = 0; i < SLOW_FILES; i++)
    files[`src/f${String(i)}.ts`] = `export const v${String(i)} = ${String(i)};\n`;
  return scratchProject("ls-slow-", files);
}

const fullPassLine = (line: string): boolean => /^checked \d+ files/.test(line);

describe("language server: a full pass does not hold the editor back", { timeout: 30_000 }, () => {
  it("answers a request while a full pass runs", async () => {
    const dir = slowProject();
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: theme,
        languageId: "typescriptreact",
        version: 1,
        text: "export const theme = 1;\n",
      },
    });
    await inbox.until(() => inbox.checking.includes(true));
    await inbox.client.sendRequest("textDocument/hover", {
      textDocument: { uri: theme },
      position: { line: 0, character: 14 },
    });
    // Answered while the pass still runs: it has not ended or logged its line.
    expect(inbox.checking).toEqual([true]);
    expect(inbox.logs.some(fullPassLine)).toBe(false);
    await inbox.until(() => inbox.checking.length === 2);
    expect(inbox.logs.filter(fullPassLine)).toHaveLength(1);
  });

  it("publishes an edited file's findings during a full pass, which the edit stops and restarts", async () => {
    const dir = slowProject();
    const inbox = collect(connect(dir));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    const theme = pathToFileURL(path.join(dir, "src", "theme.tsx")).href;
    await inbox.client.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: theme,
        languageId: "typescriptreact",
        version: 1,
        text: "export const theme = 1;\n",
      },
    });
    // Opening the file is an edit too: its fast pass runs, then the full pass after the pause.
    await inbox.until(() => inbox.checking.includes(true));
    const seen = inbox.logs.length;
    await inbox.client.sendNotification("textDocument/didChange", {
      textDocument: { uri: theme, version: 2 },
      contentChanges: [{ text: "export const theme = 1; // BAD\n" }],
    });
    const fastLine = (line: string): boolean => /^checked src[\\/]theme\.tsx in \d+ ms$/.test(line);
    await inbox.until(() => inbox.logs.slice(seen).some(fastLine));
    // The full pass that was running stopped without publishing, and the fast pass answered.
    expect(inbox.logs.slice(seen)).toEqual([
      "stateward: project check stopped by a newer change",
      expect.stringMatching(/^checked src[\\/]theme\.tsx in \d+ ms$/),
    ]);
    expect(inbox.diagnostics.filter((published) => published.uri === theme).at(-1)).toMatchObject({
      diagnostics: [{ code: "slow/rule", message: "bad\nFix: h" }],
    });

    // After the pause, the full pass runs again to its end, with the edited text.
    await inbox.until(() => inbox.logs.some(fullPassLine));
    expect(inbox.logs.find(fullPassLine)).toMatch(
      new RegExp(`^checked ${String(SLOW_FILES + 1)} files in \\d+\\.\\d s: 1 errors`),
    );
    expect(inbox.diagnostics.filter((published) => published.uri === theme).at(-1)).toMatchObject({
      diagnostics: [{ code: "slow/rule" }],
    });
    await inbox.until(() => inbox.checking.length === 4);
    expect(inbox.checking).toEqual([true, false, true, false]);
  });
});

describe("language server: the results cache on disk", { timeout: 60_000 }, () => {
  const cli = fileURLToPath(new URL("../../cli/dist/bin.js", import.meta.url));

  /** A project whose one rule reports each file's first statement and counts its runs in `runs`. */
  function probeProject(): { app: string; cache: string; runs: () => number } {
    const app = scratchProject("ls-cache-", {});
    const counter = path.join(app, "runs.txt");
    writeFileSync(counter, "");
    const files: Readonly<Record<string, string>> = {
      "tsconfig.json": TSCONFIG,
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": 'import { a } from "./a";\nexport const b = a + 1;\n',
      "stateward.config.mjs": [
        'import { appendFileSync } from "node:fs";',
        "const counted = {",
        '  kind: "file",',
        '  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },',
        "  check(ctx) {",
        `    appendFileSync(${JSON.stringify(counter)}, "x");`,
        "    const node = ctx.sourceFile.statements[0];",
        '    if (node !== undefined) ctx.report({ message: "m", hint: "h", node });',
        "  },",
        "};",
        'export default { preset: "recommended", plugins: [{ name: "probe", description: "d", rules: { counted } }] };',
        "",
      ].join("\n"),
    };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(app, name)), { recursive: true });
      writeFileSync(path.join(app, name), text);
    }
    const cache = mkdtempSync(path.join(scratchRoot, "ls-cache-dir-"));
    scratchDirs.push(cache);
    return { app, cache, runs: () => readFileSync(counter, "utf8").length };
  }

  /** `stateward check` in `app`, writing its results cache in `cache`. */
  function cliCheck(app: string, cache: string): void {
    const result = spawnSync(process.execPath, [cli, "check", "--cwd", app], {
      encoding: "utf8",
      env: { ...process.env, STATEWARD_CACHE_DIR: cache },
    });
    expect(result.stderr).toBe("");
  }

  /** The diagnostics after the first full pass, by URI, as the last publication of each left them. */
  async function firstFullPass(
    app: string,
    options: ServerOptions,
  ): Promise<{ inbox: Inbox; diagnostics: Map<string, unknown> }> {
    const inbox = collect(connect(app, [app], {}, options));
    inbox.client.sendNotification("initialized", {}).catch(rethrow);
    await inbox.until(() => inbox.statuses.length === 1);
    const diagnostics = new Map<string, unknown>();
    for (const published of inbox.diagnostics) {
      diagnostics.set(published.uri, published.diagnostics);
    }
    return { inbox, diagnostics };
  }

  const resultsFiles = (cache: string): string[] =>
    readdirSync(cache).filter((name) => /^check-[0-9a-f]+\.json$/.test(name));

  it("starts from the CLI's results: the same diagnostics as a cold start, no rule run again", async () => {
    const { app, cache, runs } = probeProject();
    const cold = await firstFullPass(app, {});
    expect(runs()).toBe(2);
    expect([...cold.diagnostics.values()].flat()).toHaveLength(2);

    cliCheck(app, cache);
    expect(runs()).toBe(4);
    expect(resultsFiles(cache)).toHaveLength(1);

    const warm = await firstFullPass(app, { cacheDir: () => cache });
    expect(runs()).toBe(4);
    expect(warm.diagnostics).toEqual(cold.diagnostics);
    expect(warm.inbox.popups).toEqual([]);
  });

  it("writes its results after a full pass, at most once per interval, and the rest when it stops", async () => {
    const { app, cache, runs } = probeProject();
    const { inbox } = await firstFullPass(app, { cacheDir: () => cache, saveMs: 60_000 });
    const [file = ""] = resultsFiles(cache);
    const written = statSync(path.join(cache, file)).ino;
    // The CLI reads what the server wrote: nothing runs again.
    cliCheck(app, cache);
    expect(runs()).toBe(2);

    writeFileSync(path.join(app, "src", "a.ts"), "export const a = 2;\n");
    await touch(inbox, path.join(app, "src", "a.ts"));
    await inbox.until(() => inbox.statuses.length === 2);
    // Written less than a minute ago: not written again yet.
    expect(statSync(path.join(cache, file)).ino).toBe(written);

    for (const dispose of disposers.splice(0)) dispose();
    expect(statSync(path.join(cache, file)).ino).not.toBe(written);
    const before = runs();
    cliCheck(app, cache);
    expect(runs()).toBe(before);
  });

  it("starts cold from a broken or foreign cache file, with no popup, and repairs it", async () => {
    const { app, cache, runs } = probeProject();
    const cold = await firstFullPass(app, {});
    for (const dispose of disposers.splice(0)) dispose();
    cliCheck(app, cache);
    const [file = ""] = resultsFiles(cache);
    const full = path.join(cache, file);
    const text = readFileSync(full, "utf8");
    for (const broken of ["{", text.slice(0, text.length / 2), '{"stateward":"0.0.0"}']) {
      writeFileSync(full, broken);
      const before = runs();
      const started = await firstFullPass(app, { cacheDir: () => cache });
      expect(runs()).toBe(before + 2);
      expect(started.diagnostics).toEqual(cold.diagnostics);
      expect(started.inbox.popups).toEqual([]);
      for (const dispose of disposers.splice(0)) dispose();
      expect(JSON.parse(readFileSync(full, "utf8"))).toHaveProperty("snapshot");
    }
  });

  describe("a JSON file a program imports", () => {
    /** A rule that reports the `probe` constant when its type (`keyof typeof data`) has the key "b". */
    const PROBE_CONFIG = [
      "const probe = {",
      '  kind: "file",',
      '  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
      "  check(ctx) {",
      "    for (const statement of ctx.sourceFile.statements) {",
      "      for (const declaration of statement.declarationList?.declarations ?? []) {",
      '        if (declaration.name.getText() !== "probe") continue;',
      "        if (ctx.types.typeTextOf(declaration.name).includes('\"b\"')) {",
      '          ctx.report({ message: "has b", hint: "h", node: declaration.name });',
      "        }",
      "      }",
      "    }",
      "  },",
      "};",
      'export default { preset: "recommended", plugins: [{ name: "probe", description: "d", rules: { keys: probe } }] };',
      "",
    ].join("\n");
    const PROBE =
      'import data from "./data.json";\nexport const probe = Object.keys(data)[0] as keyof typeof data;\n';
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
        },
        include: ["src"],
      }),
      "stateward.config.ts": PROBE_CONFIG,
      "src/probe.ts": PROBE,
      "src/data.json": '{ "a": 1 }',
    };

    it("changes a finding when its unsaved text changes, and publishes nothing for the JSON file", async () => {
      const dir = scratchProject("ls-", files);
      const inbox = collect(connect(dir));
      inbox.client.sendNotification("initialized", {}).catch(rethrow);
      const probe = pathToFileURL(path.join(dir, "src", "probe.ts")).href;
      const data = pathToFileURL(path.join(dir, "src", "data.json")).href;
      await inbox.client.sendNotification("textDocument/didOpen", {
        textDocument: { uri: probe, languageId: "typescript", version: 1, text: PROBE },
      });
      await inbox.client.sendNotification("textDocument/didOpen", {
        textDocument: { uri: data, languageId: "json", version: 1, text: '{ "a": 1 }' },
      });
      await inbox.until(() => inbox.logs.some((line) => line.startsWith("checked 1 files")));
      expect(inbox.diagnostics.flatMap((entry) => entry.diagnostics)).toEqual([]);
      const before = inbox.logs.filter((line) => line.startsWith("checked 1 files")).length;

      await inbox.client.sendNotification("textDocument/didChange", {
        textDocument: { uri: data, version: 2 },
        contentChanges: [{ text: '{ "a": 1, "b": 2 }' }],
      });
      await inbox.until(
        () => inbox.logs.filter((line) => line.startsWith("checked 1 files")).length > before,
      );
      expect(inbox.diagnostics.at(-1)).toMatchObject({ uri: probe });
      expect(inbox.diagnostics.at(-1)?.diagnostics).toHaveLength(1);
      expect(inbox.diagnostics.some((entry) => entry.uri === data)).toBe(false);
    });

    it("checks again when the saved file changes on disk", async () => {
      const dir = scratchProject("ls-", { ...files, "src/data.json": '{ "a": 1, "b": 2 }' });
      const inbox = collect(connect(dir));
      inbox.client.sendNotification("initialized", {}).catch(rethrow);
      const probe = pathToFileURL(path.join(dir, "src", "probe.ts")).href;
      await inbox.client.sendNotification("textDocument/didOpen", {
        textDocument: { uri: probe, languageId: "typescript", version: 1, text: PROBE },
      });
      await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 1);
      writeFileSync(path.join(dir, "src", "data.json"), '{ "a": 1 }');
      await touch(inbox, path.join(dir, "src", "data.json"));
      await inbox.until(() => inbox.diagnostics.at(-1)?.diagnostics.length === 0);
    });
  });
});
