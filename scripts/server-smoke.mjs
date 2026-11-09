// Starts the language server bundled into the VS Code extension (packages/vscode/dist/server.cjs)
// against examples/basic, opens a file with known findings, and fails unless they arrive.
// The bundle differs from the unbundled server (one file, CommonJS, its own jiti and TypeScript),
// so it needs its own check: a config it cannot load shows nothing at all in the editor, and a
// bundle that cannot find TypeScript's lib.*.d.ts files loses every rule that reads a standard type
// (`Record`), so the second finding below needs them.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromServer = createRequire(path.join(root, "packages", "language-server", "package.json"));
const rpc = fromServer("vscode-jsonrpc/node");
const server = path.join(root, "packages", "vscode", "dist", "server.cjs");
const app = path.join(root, "examples", "basic");
const file = path.join(app, "src", "status.ts");
const EXPECTED = ["unions/non-exhaustive-switch", "records/lookup-misses-key"];
const TIMEOUT_MS = 30_000;

const child = spawn(process.execPath, [server, "--stdio"], { stdio: ["pipe", "pipe", "inherit"] });
const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(child.stdout),
  new rpc.StreamMessageWriter(child.stdin),
);

function finish(ok, message) {
  console.log(`${ok ? "pass" : "FAIL"}  bundled server: ${message}`);
  child.kill();
  process.exit(ok ? 0 : 1);
}

connection.onNotification("window/showMessage", (params) => finish(false, params.message));
connection.onNotification("textDocument/publishDiagnostics", (params) => {
  if (params.uri !== pathToFileURL(file).href) return;
  const codes = params.diagnostics.map((diagnostic) => String(diagnostic.code));
  if (EXPECTED.every((code) => codes.includes(code))) finish(true, codes.join(", "));
});
connection.listen();
setTimeout(
  () => finish(false, `no ${EXPECTED.join(" and ")} for ${file} in ${String(TIMEOUT_MS)} ms`),
  TIMEOUT_MS,
);

const folder = pathToFileURL(app).href;
await connection.sendRequest("initialize", {
  processId: null,
  rootUri: folder,
  capabilities: {},
  workspaceFolders: [{ uri: folder, name: "basic" }],
});
await connection.sendNotification("initialized", {});
await connection.sendNotification("textDocument/didOpen", {
  textDocument: {
    uri: pathToFileURL(file).href,
    languageId: "typescript",
    version: 1,
    text: readFileSync(file, "utf8"),
  },
});
