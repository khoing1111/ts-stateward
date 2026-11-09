import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  locateServer,
  serverPathNotice,
  serverPathNoticeKey,
  serverSourceLine,
  serverSourceNote,
  unsupportedMessage,
  type ServerLocation,
} from "../src/server-location.js";

const bundled = "/extension/dist/server.cjs";
let dir = "";
let temporary = "";

beforeEach(() => {
  // The workspace is reached through a link, as every folder under macOS's `/tmp` is.
  temporary = mkdtempSync(path.join(tmpdir(), "stateward-vscode-"));
  mkdirSync(path.join(temporary, "workspace"));
  symlinkSync(path.join(temporary, "workspace"), path.join(temporary, "link"), "dir");
  dir = path.join(temporary, "link");
});

afterEach(() => {
  rmSync(temporary, { recursive: true, force: true });
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
  // Node's resolver follows links: the server is found at its real path.
  return realpathSync(path.join(packageDir, "dist", "bin.js"));
}

describe("locateServer", () => {
  it("prefers the workspace's own language server", () => {
    const installed = installServer();
    expect(locateServer(dir, bundled)).toEqual({ kind: "workspace", modulePath: installed });
  });

  it("prefers the stateward.serverPath setting over everything, when the file exists", () => {
    const installed = installServer();
    const clone = "/clone/packages/language-server/dist/bin.js";
    expect(locateServer(dir, bundled, { path: clone, exists: () => true })).toEqual({
      kind: "configured",
      modulePath: clone,
      projectServer: installed,
    });
  });

  it("uses the project's server, with no notice, when the setting names it through a link", () => {
    const installed = installServer();
    const linked = path.join(
      dir,
      "node_modules",
      "@stateward",
      "language-server",
      "dist",
      "bin.js",
    );
    expect(linked).not.toBe(installed);
    expect(
      locateServer(dir, bundled, { path: linked, exists: () => true, realPath: realpathSync }),
    ).toEqual({ kind: "workspace", modulePath: installed });
  });

  it("notes that the project has no server of its own when the setting is used", () => {
    const clone = "/clone/packages/language-server/dist/bin.js";
    expect(locateServer(dir, bundled, { path: clone, exists: () => true })).toEqual({
      kind: "configured",
      modulePath: clone,
      projectServer: undefined,
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

const clone = "/clone/stateward/packages/language-server/dist/bin.js";
const project = "/work/app/node_modules/@stateward/language-server/dist/bin.js";
const configured: ServerLocation = {
  kind: "configured",
  modulePath: clone,
  projectServer: project,
};
const configuredAlone: ServerLocation = {
  kind: "configured",
  modulePath: clone,
  projectServer: undefined,
};

describe("which server is used", () => {
  it("names the server in the log, and the setting when it is used", () => {
    expect(serverSourceLine(configured)).toBe(
      `Stateward is using the server from the stateward.serverPath setting: ${clone}`,
    );
    expect(serverSourceLine({ kind: "workspace", modulePath: project })).toBe(
      `Stateward is using the project's server: ${project}`,
    );
    expect(serverSourceLine({ kind: "bundled", modulePath: bundled })).toBe(
      `Stateward is using the server bundled with the extension: ${bundled}`,
    );
  });

  it("adds a tooltip line only when the setting is used", () => {
    expect(serverSourceNote(configured)).toBe(serverSourceLine(configured));
    expect(serverSourceNote({ kind: "workspace", modulePath: project })).toBe(undefined);
    expect(serverSourceNote({ kind: "bundled", modulePath: bundled })).toBe(undefined);
    expect(serverSourceNote(undefined)).toBe(undefined);
  });

  it("notifies only when the setting overrides a server the project has", () => {
    expect(serverPathNotice(configured)).toBe(
      `Stateward is using the server from the stateward.serverPath setting (${clone}), not the project's @stateward/language-server (${project}). The setting is in your user settings.`,
    );
    expect(serverPathNotice(configuredAlone)).toBe(undefined);
    expect(serverPathNotice({ kind: "workspace", modulePath: project })).toBe(undefined);
  });

  it("remembers the notification per pair of servers", () => {
    const other: ServerLocation = { ...configured, projectServer: "/other/bin.js" };
    expect(serverPathNoticeKey(configured)).toBe(serverPathNoticeKey({ ...configured }));
    expect(serverPathNoticeKey(configured)).not.toBe(serverPathNoticeKey(other));
  });
});

describe("unsupportedMessage", () => {
  it("names the server, the command and how to change it", () => {
    expect(unsupportedMessage(configured, "Check again")).toBe(
      `The language server at ${clone} is older than the extension and does not support Check again. Remove stateward.serverPath from your user settings, or update @stateward/language-server.`,
    );
    expect(
      unsupportedMessage({ kind: "workspace", modulePath: project }, "Show the rule plan"),
    ).toBe(
      `The project's language server at ${project} is older than the extension and does not support Show the rule plan. Update @stateward/language-server in the project.`,
    );
    expect(unsupportedMessage(undefined, "Check again")).toBe(
      "The language server does not support Check again. Reinstall the Stateward extension.",
    );
  });
});
