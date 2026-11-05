import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createChecker, createTimingRecorder, emptyCache, parseConfig } from "../src/internal.js";
import type { Plugin, ResultCache, Rule, RunTiming, TimingRecorder } from "../src/internal.js";
import { fixturePath } from "./fixture-path.js";

const dir = fixturePath("deps");
const meta = {
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "d",
} as const;

/** A file rule that asks the type of every exported `const`. */
const literals: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const statement of ctx.sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const found = ctx.types.literalsOf(declaration.name);
        if (found !== "not-finite" && found.length > 0) {
          ctx.report({ node: declaration.name, message: found[0]?.label ?? "", hint: "h" });
        }
      }
    }
  },
};

/** A project rule that summarizes each file's statement count and reports the largest file. */
const largest: Rule = {
  kind: "project",
  meta,
  summarize: (ctx) => ctx.sourceFile.statements.length,
  check(summaries, ctx) {
    const [file] = [...summaries].sort(([, a], [, b]) => Number(b) - Number(a))[0] ?? [];
    if (file !== undefined) {
      ctx.report({ message: "largest", hint: "h", location: { file, start: 0, end: 0 } });
    }
  },
};

function check(timing?: TimingRecorder, cache?: ResultCache) {
  const plugins: Plugin[] = [{ name: "p", description: "p", rules: { literals, largest } }];
  const parsed = parseConfig({ preset: "recommended", plugins }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({
    config: parsed.value,
    cwd: dir,
    cache: cache ?? false,
    ...(timing === undefined ? {} : { timing }),
  }).check();
}

const ruleOf = (run: RunTiming, id: string) => run.rules.find((rule) => rule.ruleId === id);

describe("the timing of a check (check --timing)", () => {
  it("records each rule's cost without changing the findings", () => {
    const plain = check();
    const timing = createTimingRecorder();
    const timed = check(timing);
    expect(timed.findings).toEqual(plain.findings);
    const run = timing.result();
    const files = plain.stats.files;
    expect(ruleOf(run, "p/literals")).toMatchObject({
      kind: "file",
      files,
      reused: 0,
      projectMs: 0,
      warmMs: undefined,
    });
    expect(ruleOf(run, "p/largest")).toMatchObject({ kind: "project", files, reused: 0 });
    for (const rule of run.rules) {
      expect(rule.ms).toBe(rule.fileMs + rule.projectMs);
      expect(rule.typeMs).toBeLessThanOrEqual(rule.ms);
      expect(rule.allocatedBytes).toBeGreaterThanOrEqual(0);
    }
    expect(run.rules.map((rule) => rule.ms)).toEqual(
      [...run.rules.map((rule) => rule.ms)].sort((a, b) => b - a),
    );
    expect(run.programMs).toBeGreaterThan(0);
    expect(run.totalMs).toBeGreaterThanOrEqual(run.programMs);
    expect(run.secondPassMs).toBeUndefined();
  });

  it("counts results taken from the cache instead of timing them", () => {
    const cache = emptyCache();
    check(undefined, cache);
    const timing = createTimingRecorder();
    check(timing, cache);
    const files = check().stats.files;
    expect(ruleOf(timing.result(), "p/literals")).toMatchObject({ files: 0, reused: files });
  });

  it("with a second pass, times every rule again on a warm checker, outside the check's total", () => {
    const plain = check();
    const timing = createTimingRecorder({ secondPass: true });
    const timed = check(timing);
    expect(timed.findings).toEqual(plain.findings);
    const run = timing.result();
    const literalsCost = ruleOf(run, "p/literals");
    expect(literalsCost?.warmMs).toBeGreaterThanOrEqual(0);
    expect(literalsCost?.warmTypeMs).toBeLessThanOrEqual(literalsCost?.warmMs ?? 0);
    expect(run.secondPassMs).toBeGreaterThanOrEqual(0);
  });
});
