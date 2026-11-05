import path from "node:path";
import { describe, expect, it } from "vitest";
import { NothingToCheckError, parseConfig, check } from "../src/internal.js";
import type { Finding, Rule } from "../src/internal.js";
import { checkFixture } from "../src/testing.js";
import { fixturePath, posix } from "./fixture-path.js";
import { literalProbe, meta, plugin } from "./probe-plugin.js";

const files: Rule = {
  kind: "file",
  meta,
  check: (ctx) => {
    ctx.report({ message: path.basename(ctx.file), hint: "h", node: ctx.sourceFile });
  },
};

function where(findings: readonly Finding[], root: string): string[] {
  return findings.map((f) => `${posix(path.relative(root, f.location.file))} ${f.message}`);
}

describe("tsconfig project references", () => {
  const dir = fixturePath("solution");

  it("checks the projects a solution tsconfig references, each with its own options", () => {
    const { findings, stats } = checkFixture(dir, [plugin({ literals: literalProbe })]);
    // shared/both.ts is in both projects and is checked once, in the first (strict) one.
    expect(where(findings, dir)).toEqual([
      'node/vite.config.ts probeNode: "a"',
      'shared/both.ts probeShared: "a",null',
      'src/app.ts probeApp: "a",null',
    ]);
    expect(stats.files).toBe(3);
  });

  it("applies the stateward include to the files of every project", () => {
    const parsed = parseConfig(
      { preset: "recommended", plugins: [plugin({ files })], include: ["src/**"] },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const { findings } = check({ config: parsed.value, cwd: dir });
    expect(findings.map((f) => f.message)).toEqual(["app.ts"]);
  });

  it("visits a project once when references form a cycle", () => {
    const cycle = fixturePath("cycle");
    const { findings } = checkFixture(cycle, [plugin({ files })]);
    expect(findings.map((f) => f.message)).toEqual(["a.ts", "b.ts"]);
  });

  it("throws NothingToCheckError, with a hint, when no project lists a file", () => {
    const empty = fixturePath("empty");
    const error = (() => {
      try {
        checkFixture(empty, [plugin({ files })]);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(NothingToCheckError);
    if (!(error instanceof NothingToCheckError)) return;
    expect(error.message).toBe("`tsconfig.json` gives stateward no files to check");
    expect(error.hint).toBe(
      'point "tsconfig" in stateward.config.ts at a tsconfig that lists your source files, or widen "include"',
    );
  });

  it("throws NothingToCheckError when the stateward include removes every file", () => {
    const parsed = parseConfig(
      { preset: "recommended", plugins: [], include: ["nowhere/**"] },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(() => check({ config: parsed.value, cwd: dir })).toThrow(NothingToCheckError);
  });
});
