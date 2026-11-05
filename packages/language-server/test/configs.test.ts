import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConfigLocator, folderOf } from "../src/configs.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tree(files: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-configs-"));
  dirs.push(dir);
  for (const name of files) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), "");
  }
  return dir;
}

describe("folderOf", () => {
  it("picks the innermost folder that holds the file", () => {
    const root = path.resolve("/work");
    const inner = path.join(root, "packages", "a");
    expect(folderOf(path.join(inner, "src", "a.ts"), [root, inner])).toBe(inner);
    expect(folderOf(path.join(root, "b.ts"), [root, inner])).toBe(root);
    expect(folderOf(path.resolve("/elsewhere/c.ts"), [root, inner])).toBeUndefined();
    // A sibling whose name starts the same is not inside.
    expect(folderOf(path.join(`${inner}-b`, "c.ts"), [inner])).toBeUndefined();
  });
});

describe("createConfigLocator", () => {
  it("finds the nearest config above a file, never above its workspace folder", () => {
    const dir = tree([
      "stateward.config.ts",
      "repo/stateward.config.ts",
      "repo/packages/a/stateward.config.mjs",
      "repo/packages/a/src/a.ts",
      "repo/packages/b/src/b.ts",
      "other/src/c.ts",
    ]);
    const repo = path.join(dir, "repo");
    const other = path.join(dir, "other");
    const locator = createConfigLocator([repo, other]);
    expect(locator.configOf(path.join(repo, "packages", "a", "src", "a.ts"))).toBe(
      path.join(repo, "packages", "a", "stateward.config.mjs"),
    );
    expect(locator.configOf(path.join(repo, "packages", "b", "src", "b.ts"))).toBe(
      path.join(repo, "stateward.config.ts"),
    );
    // The config above the folder `other` is outside the workspace.
    expect(locator.configOf(path.join(other, "src", "c.ts"))).toBeUndefined();
    expect(locator.rootConfigs()).toEqual([path.join(repo, "stateward.config.ts")]);
  });

  it("walks past an inner workspace folder up to the outermost one that holds the file", () => {
    const dir = tree(["repo/stateward.config.ts", "repo/packages/app/src/a.ts"]);
    const repo = path.join(dir, "repo");
    const app = path.join(repo, "packages", "app");
    for (const folders of [
      [repo, app],
      [app, repo],
    ]) {
      expect(createConfigLocator(folders).configOf(path.join(app, "src", "a.ts"))).toBe(
        path.join(repo, "stateward.config.ts"),
      );
    }
    // Opened alone, the inner folder still stops the search at itself.
    expect(createConfigLocator([app]).configOf(path.join(app, "src", "a.ts"))).toBeUndefined();
  });

  it("looks again after forget, for a config created later", () => {
    const dir = tree(["src/a.ts"]);
    const locator = createConfigLocator([dir]);
    const file = path.join(dir, "src", "a.ts");
    expect(locator.configOf(file)).toBeUndefined();
    writeFileSync(path.join(dir, "stateward.config.ts"), "");
    expect(locator.configOf(file)).toBeUndefined();
    locator.forget();
    expect(locator.configOf(file)).toBe(path.join(dir, "stateward.config.ts"));
  });
});
