import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateServer } from "../src/server-location.js";

const bundled = "/extension/dist/server.cjs";
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-vscode-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function installServer(): string {
  const packageDir = path.join(dir, "node_modules", "@stateward", "language-server");
  mkdirSync(path.join(packageDir, "dist"), { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "@stateward/language-server",
      exports: { "./bin": { default: "./dist/bin.js" } },
    }),
  );
  writeFileSync(path.join(packageDir, "dist", "bin.js"), "");
  return path.join(packageDir, "dist", "bin.js");
}

describe("locateServer", () => {
  it("prefers the workspace's own language server", () => {
    const installed = installServer();
    expect(locateServer(dir, bundled)).toEqual({ kind: "workspace", modulePath: installed });
  });

  it("prefers the stateward.serverPath setting over everything, when the file exists", () => {
    installServer();
    const clone = "/clone/packages/language-server/dist/bin.js";
    expect(locateServer(dir, bundled, { path: clone, exists: () => true })).toEqual({
      kind: "configured",
      modulePath: clone,
    });
  });

  it("ignores a stateward.serverPath that does not exist", () => {
    expect(locateServer(dir, bundled, { path: "/nowhere/bin.js", exists: () => false })).toEqual({
      kind: "bundled",
      modulePath: bundled,
    });
  });

  it("falls back to the bundled copy when the workspace has none", () => {
    expect(locateServer(dir, bundled)).toEqual({ kind: "bundled", modulePath: bundled });
  });

  it("uses the bundled copy when there is no workspace folder", () => {
    expect(locateServer(undefined, bundled)).toEqual({ kind: "bundled", modulePath: bundled });
  });
});
