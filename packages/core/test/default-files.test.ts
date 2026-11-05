import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { check, parseConfig } from "../src/internal.js";
import type { Rule } from "../src/internal.js";
import { meta, plugin } from "./probe-plugin.js";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(dir: string, file: string, text: string): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

/** The files, relative to `dir`, that the default settings give the rules. */
function checkedFiles(tsconfigExclude: readonly string[]): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-files-"));
  temporary.push(dir);
  write(
    dir,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { strict: true },
      include: ["src"],
      exclude: tsconfigExclude,
    }),
  );
  for (const file of [
    "src/app.ts",
    "src/legacy/old.ts",
    "src/thing.testing.ts",
    "src/__scenarios__/a.ts",
    "src/__fixtures__/b.ts",
    "src/__mocks__/c.ts",
    "src/thing.test.ts",
  ]) {
    write(dir, file, "export const value = 1;\n");
  }
  const seen: string[] = [];
  const rule: Rule = {
    kind: "file",
    meta,
    check: (ctx) => {
      seen.push(path.relative(dir, ctx.file).split(path.sep).join("/"));
    },
  };
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin({ seen: rule })] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  check({ config: parsed.value, cwd: dir });
  return seen.sort();
}

describe("the files checked by default", () => {
  it("skips test helpers, scenarios, fixtures and mocks", () => {
    expect(checkedFiles([])).toEqual(["src/app.ts", "src/legacy/old.ts"]);
  });

  it("also skips what the project's tsconfig excludes", () => {
    expect(checkedFiles(["src/legacy"])).toEqual(["src/app.ts"]);
  });
});
