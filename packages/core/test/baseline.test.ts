import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASELINE_FILE,
  BaselineError,
  applyBaseline,
  baselineOf,
  fingerprintOf,
  isOutdated,
  mergeBaseline,
  parseConfig,
  readBaseline,
  sizeOf,
  writeBaseline,
} from "../src/internal.js";
import type { CheckResult, Config, FileRule, Finding } from "../src/internal.js";
import { plugin } from "./probe-plugin.js";

const noop: FileRule = {
  kind: "file",
  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },
  check: () => undefined,
};

let dir = "";
let config: Config;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-baseline-"));
  const parsed = parseConfig({ plugins: [plugin({ one: noop })] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  config = parsed.value;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (): string => path.join(dir, BASELINE_FILE);
const source = path.join("src", "a.ts");
const absolute = (): string => path.join(dir, source);

/** A problem at the first occurrence of `needle` in `text`. */
function problem(text: string, needle: string, message = "m", ruleId = "probe/one"): Finding {
  const start = text.indexOf(needle, 0);
  return {
    kind: "problem",
    ruleId,
    severity: "error",
    message,
    hint: "h",
    location: { file: absolute(), start, end: start + needle.length },
    related: [],
    fixes: [],
  };
}

function context(text: string): { configDir: string; readText: (f: string) => string | undefined } {
  return { configDir: dir, readText: (f) => (f === absolute() ? text : undefined) };
}

function resultOf(findings: readonly Finding[]): CheckResult {
  return { findings, hidden: [], stats: { files: 1, durationMs: 0 } };
}

const ran = new Set(["probe/one"]);

describe("fingerprints", () => {
  const input = {
    ruleId: "a/b",
    file: "src/a.ts",
    text: "x\n  foo( 1 )\ny",
    start: 4,
    end: 11,
  };

  it("do not depend on where the code is", () => {
    const moved = { ...input, text: "\n\n\nx\nx\n  foo( 1 )\ny", start: 8, end: 15 };
    expect(fingerprintOf(moved)).toBe(fingerprintOf(input));
  });

  it("ignore indentation and spacing of the flagged line", () => {
    const reflowed = { ...input, text: "x\n\t\tfoo(   1 )  \ny", start: 4, end: 11 };
    expect(fingerprintOf(reflowed)).toBe(fingerprintOf(input));
  });

  it("change when the flagged line changes, or the rule or file does; never with the message", () => {
    const base = fingerprintOf(input);
    expect(fingerprintOf({ ...input, text: "x\n  foo( 2 )\ny" })).not.toBe(base);
    expect(fingerprintOf({ ...input, ruleId: "a/c" })).not.toBe(base);
    expect(fingerprintOf({ ...input, file: "src/b.ts" })).not.toBe(base);
  });

  it("cover every line of a finding that spans several", () => {
    const text = "a\nb(\n  1,\n)\nc";
    const span = { ...input, text, start: 2, end: 11 };
    expect(fingerprintOf(span)).not.toBe(fingerprintOf({ ...span, text: text.replace("1", "2") }));
  });
});

describe("the baseline file", () => {
  it("round-trips what was written, sorted, with counts only above 1", () => {
    const text = "let a = 1;\nlet b = 2;\nlet b = 2;\n";
    const baseline = baselineOf(
      [problem(text, "let b = 2;"), problem(text, "let a = 1;"), problem(text, "let b = 2;")],
      context(text),
    );
    writeBaseline(config, baseline);
    expect(readBaseline(config)).toEqual(baseline);
    const written: unknown = JSON.parse(readFileSync(file(), "utf8"));
    expect(written).toMatchObject({ version: 2 });
    expect(sizeOf(baseline)).toEqual({ findings: 3, files: 1 });
    expect(baseline.entries.map((entry) => entry.count).sort()).toEqual([1, 2]);
    expect(baseline.entries.every((entry) => entry.file === "src/a.ts")).toBe(true);
    expect(readFileSync(file(), "utf8")).not.toContain('"count": 1');
  });

  it("treats a missing file as no baseline", () => {
    expect(readBaseline(config)).toBeUndefined();
  });

  it("leaves no temp file beside it", () => {
    writeBaseline(config, { entries: [] });
    writeBaseline(config, { entries: [] });
    expect(readdirSync(dir)).toEqual([BASELINE_FILE]);
  });

  it.each([
    ["{ not json", "is not valid JSON"],
    ["[]", "must be an object"],
    ['{ "version": 3, "findings": [] }', "has version 3"],
    [
      '{ "version": 2, "findings": [{ "ruleId": "a", "file": "f", "message": "m", "legacy": "yes" }] }',
      '"legacy"',
    ],
    [
      '{ "version": 1, "findings": [{ "ruleId": "a", "file": "f", "fingerprint": "x", "message": "m", "legacy": true }] }',
      'unknown key "legacy"',
    ],
    ['{ "version": 1, "findings": [], "extra": 1 }', 'unknown key "extra"'],
    ['{ "version": 1, "findings": {} }', '"findings" must be a list'],
    ['{ "version": 1, "findings": [1] }', "not an object"],
    ['{ "version": 1, "findings": [{ "ruleId": "a" }] }', "needs"],
    [
      '{ "version": 1, "findings": [{ "ruleId": "a", "file": "f", "fingerprint": "x", "message": "m", "count": 0 }] }',
      "whole number",
    ],
    [
      '{ "version": 1, "findings": [{ "ruleId": "a", "file": "f", "fingerprint": "x", "message": "m" }, { "ruleId": "a", "file": "f", "fingerprint": "x", "message": "m" }] }',
      "twice",
    ],
  ])("names the file and the way out for %s", (text, why) => {
    writeFileSync(file(), text);
    expect(() => readBaseline(config)).toThrow(BaselineError);
    expect(() => readBaseline(config)).toThrow(why);
    expect(() => readBaseline(config)).toThrow(BASELINE_FILE);
    expect(() => readBaseline(config)).toThrow("stateward baseline");
  });
});

describe("laying a baseline over a check", () => {
  const text = "foo(1);\nfoo(2);\n";

  it("accepts the findings of the baseline, wherever the code is now", () => {
    const baseline = baselineOf([problem(text, "foo(1);")], context(text));
    const moved = `// new\n\n${text}`;
    const view = applyBaseline(baseline, resultOf([problem(moved, "foo(1);")]), {
      ...context(moved),
      ran,
    });
    expect(view.baselined).toHaveLength(1);
    expect(view.fresh.findings).toEqual([]);
    expect(view.fixed).toBe(0);
  });

  it("makes a finding new when the flagged code is edited", () => {
    const baseline = baselineOf([problem(text, "foo(1);")], context(text));
    const edited = text.replace("foo(1)", "foo(11)");
    const view = applyBaseline(baseline, resultOf([problem(edited, "foo(11);")]), {
      ...context(edited),
      ran,
    });
    expect(view.baselined).toEqual([]);
    expect(view.fresh.findings).toHaveLength(1);
    expect(view.fixed).toBe(1);
  });

  it("consumes counts: a third copy of two accepted ones is new", () => {
    const twice = "foo(1);\nfoo(1);\n";
    const baseline = baselineOf(
      [problem(twice, "foo(1);"), problem(twice, "foo(1);")],
      context(twice),
    );
    expect(baseline.entries[0]?.count).toBe(2);
    const thrice = "foo(1);\nfoo(1);\nfoo(1);\n";
    const at = (start: number): Finding => ({
      ...problem(thrice, "foo(1);"),
      location: { file: absolute(), start, end: start + 7 },
    });
    const view = applyBaseline(baseline, resultOf([at(0), at(8), at(16)]), {
      ...context(thrice),
      ran,
    });
    expect(view.baselined).toHaveLength(2);
    expect(view.fresh.findings).toHaveLength(1);
  });

  it("counts fixed entries and prunes them", () => {
    const both = baselineOf([problem(text, "foo(1);"), problem(text, "foo(2);")], context(text));
    const view = applyBaseline(both, resultOf([problem(text, "foo(2);")]), {
      ...context(text),
      ran,
    });
    expect(view.fixed).toBe(1);
    expect(view.pruned).toEqual(baselineOf([problem(text, "foo(2);")], context(text)));
    expect(sizeOf(view.pruned ?? { entries: [] }).findings).toBe(1);
  });

  it("ignores entries of rules that did not run: neither matched nor fixed", () => {
    const other = baselineOf([problem(text, "foo(1);", "m", "probe/two")], context(text));
    const view = applyBaseline(other, resultOf([]), { ...context(text), ran });
    expect(view.fixed).toBe(0);
    expect(view.pruned).toEqual(other);
  });

  it("never accepts a rule failure", () => {
    const failure: Finding = {
      kind: "failure",
      ruleId: "probe/one",
      message: "m",
      hint: "h",
      location: { file: absolute(), start: 0, end: 0 },
    };
    expect(baselineOf([failure], context(text)).entries).toEqual([]);
    const baseline = baselineOf([problem(text, "foo(1);")], context(text));
    const view = applyBaseline(baseline, resultOf([failure]), { ...context(text), ran });
    expect(view.fresh.findings).toEqual([failure]);
  });

  it("never stores a place not checked, and never hides one an older baseline stored", () => {
    const notChecked: Finding = {
      kind: "unknown",
      ruleId: "probe/one",
      message: "stateward cannot tell what `foo` returns",
      hint: "h",
      location: { file: absolute(), start: 8, end: 15 },
    };
    const found = problem(text, "foo(1);");
    expect(baselineOf([notChecked, found], context(text))).toEqual(
      baselineOf([found], context(text)),
    );
    const older = baselineOf([found], context(text));
    const stored = {
      entries: [
        ...older.entries,
        ...baselineOf([{ ...found, location: notChecked.location }], context(text)).entries,
      ],
    };
    const view = applyBaseline(stored, resultOf([notChecked, found]), { ...context(text), ran });
    expect(view.fresh.findings).toEqual([notChecked]);
    expect(view.baselined).toEqual([found]);
    expect(view.fixed).toBe(0);
  });

  it("without a baseline everything is new, capped like a plain check", () => {
    const many = Array.from({ length: 25 }, () => problem(text, "foo(1);"));
    const view = applyBaseline(undefined, resultOf(many), { ...context(text), ran });
    expect(view.fresh.findings).toHaveLength(20);
    expect(view.fresh.hidden).toEqual([{ file: absolute(), ruleId: "probe/one", count: 5 }]);
    expect(view.pruned).toBeUndefined();
  });

  it("does not cap what the baseline accepts: only the new findings are capped", () => {
    const many = Array.from({ length: 25 }, () => problem(text, "foo(1);"));
    const baseline = baselineOf(many, context(text));
    const view = applyBaseline(baseline, resultOf(many), { ...context(text), ran });
    expect(view.baselined).toHaveLength(25);
    expect(view.fresh.hidden).toEqual([]);
  });

  it("fails clearly when a file cannot be read", () => {
    const baseline = baselineOf([problem(text, "foo(1);")], context(text));
    expect(() =>
      applyBaseline(baseline, resultOf([problem(text, "foo(1);")]), {
        configDir: dir,
        readText: () => undefined,
        ran,
      }),
    ).toThrow(BaselineError);
  });

  it("merges: the rules that ran are replaced, the others keep their entries", () => {
    const old = baselineOf(
      [problem(text, "foo(1);"), problem(text, "foo(2);", "m", "probe/two")],
      context(text),
    );
    const built = baselineOf([problem(text, "foo(2);")], context(text));
    const merged = mergeBaseline(old, ran, built);
    expect(merged.entries.map((e) => e.ruleId).sort()).toEqual(["probe/one", "probe/two"]);
    expect(merged.entries.find((e) => e.ruleId === "probe/one")).toEqual(built.entries[0]);
  });
});

/** A baseline file as the first format wrote it: version 1, headline in the fingerprint. */
function writeLegacy(findings: readonly Record<string, unknown>[]): void {
  writeFileSync(file(), JSON.stringify({ version: 1, findings }));
}

describe("a baseline an older stateward wrote", () => {
  const text = "setLoading(true);\nsetLoading(true);\nfoo(1);\n";
  const now = "async/pending-state-stuck-on-failure";
  const reworded = (needle: string): Finding =>
    problem(text, needle, "if `fetch()` fails, `loading` stays `true`", now);
  const at = (start: number): Finding => ({
    ...reworded("setLoading(true);"),
    location: { file: absolute(), start, end: start + 17 },
  });

  it("accepts findings of its rules, reworded since, by count per file", () => {
    writeLegacy([
      {
        ruleId: now,
        file: "src/a.ts",
        fingerprint: "0123456789abcdef",
        message: "`loading` is never reset",
      },
      {
        ruleId: now,
        file: "src/a.ts",
        fingerprint: "fedcba9876543210",
        message: "`loading` is never reset",
      },
    ]);
    const baseline = readBaseline(config);
    expect(baseline?.entries).toEqual([
      {
        kind: "legacy",
        ruleId: now,
        file: "src/a.ts",
        message: "`loading` is never reset",
        count: 2,
      },
    ]);
    expect(isOutdated(baseline)).toBe(true);
    const third = reworded("foo(1);");
    const view = applyBaseline(baseline, resultOf([at(0), at(18), third]), {
      ...context(text),
      ran: new Set([now]),
    });
    expect(view.baselined).toHaveLength(2);
    expect(view.fresh.findings).toEqual([third]);
    expect(view.fixed).toBe(0);
  });

  it("prunes only the legacy counts no finding used, and keeps the rest legacy", () => {
    writeLegacy([
      {
        ruleId: now,
        file: "src/a.ts",
        fingerprint: "a",
        message: "m",
        count: 3,
      },
    ]);
    const view = applyBaseline(readBaseline(config), resultOf([at(0), at(18)]), {
      ...context(text),
      ran: new Set([now]),
    });
    expect(view.fixed).toBe(1);
    expect(view.pruned?.entries).toEqual([
      { kind: "legacy", ruleId: now, file: "src/a.ts", message: "m", count: 2 },
    ]);
    writeBaseline(config, view.pruned ?? { entries: [] });
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      version: 2,
      findings: [{ ruleId: now, file: "src/a.ts", message: "m", count: 2, legacy: true }],
    });
    expect(readBaseline(config)).toEqual(view.pruned);
  });

  it("is written again in the current format by `stateward baseline`, keeping rules that did not run", () => {
    writeLegacy([
      {
        ruleId: now,
        file: "src/a.ts",
        fingerprint: "a",
        message: "m",
        count: 2,
      },
      { ruleId: "probe/two", file: "src/a.ts", fingerprint: "b", message: "m" },
    ]);
    const existing = readBaseline(config);
    const built = baselineOf([at(0), at(18)], context(text));
    const merged = mergeBaseline(existing, new Set([now]), built);
    writeBaseline(config, merged);
    const again = readBaseline(config);
    expect(again?.entries.find((entry) => entry.ruleId === now)).toMatchObject({
      kind: "fingerprint",
      count: 2,
    });
    expect(again?.entries.find((entry) => entry.ruleId === "probe/two")?.kind).toBe("legacy");
    expect(isOutdated(baselineOf([at(0)], context(text)))).toBe(false);
  });
});
