import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE_NAMES as CORE_CONFIG_FILE_NAMES } from "@stateward/core/internal";
import {
  CONFIG_FILE_NAMES,
  WATCH_GLOBS,
  folderWithConfig,
  hasStatewardConfig,
} from "../src/workspace-config.js";

let dir = "";

afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("the config file names", () => {
  // The extension keeps its own copy (importing core would bundle TypeScript into the client);
  // this test keeps the copy equal to core's, which owns the list.
  it("are core's", () => {
    expect(CONFIG_FILE_NAMES).toEqual(CORE_CONFIG_FILE_NAMES);
  });
});

describe("hasStatewardConfig", () => {
  it("is false for no folders and for a folder without a config", () => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-vscode-"));
    expect(hasStatewardConfig([])).toBe(false);
    expect(hasStatewardConfig([dir])).toBe(false);
  });

  it("is true when any folder has a config at its root", () => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-vscode-"));
    writeFileSync(path.join(dir, "stateward.config.mjs"), "export default {};\n");
    expect(hasStatewardConfig(["/nonexistent-folder", dir])).toBe(true);
  });
});

describe("folderWithConfig", () => {
  it("is the first folder with a config at its root", () => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-vscode-"));
    writeFileSync(path.join(dir, "stateward.config.ts"), "export default {};\n");
    expect(folderWithConfig(["/nonexistent-folder", dir])).toBe(dir);
    expect(folderWithConfig(["/nonexistent-folder"])).toBeUndefined();
  });
});

describe("WATCH_GLOBS", () => {
  it("includes the rollout file, so `stateward next` in a terminal re-checks the project", () => {
    expect(WATCH_GLOBS).toContain("**/stateward.rollout.json");
    expect(WATCH_GLOBS).toContain("**/stateward.baseline.json");
  });
});
