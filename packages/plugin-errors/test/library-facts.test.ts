import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Checker, Finding, PackageFactsConfig, RuleSetting } from "@stateward/core";
import { errors } from "../src/index.js";
import { MAX_FUNCTIONS, forgetPackageFacts, packageFactsStats } from "../src/inference/packages.js";
import { fixture } from "./helpers.js";

/**
 * A project with a fake node_modules (copied from the fixture's `packages/`, as git keeps no
 * node_modules folder), one package per source of facts and per reason a package is unknown.
 * The global package cache goes to a temporary folder.
 */
let project = "";
let cacheDir = "";
const savedCacheDir = process.env.STATEWARD_PACKAGE_CACHE_DIR;

/** `large-lib`: a chain of more functions than inference follows. */
function writeLargePackage(root: string): void {
  const dir = path.join(root, "node_modules", "large-lib");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    '{ "name": "large-lib", "version": "9.9.9", "type": "module", "main": "index.js" }\n',
  );
  writeFileSync(path.join(dir, "index.d.ts"), "export declare function deep(): number;\n");
  const count = MAX_FUNCTIONS + 10;
  const lines = [`export function deep() {\n  return f0();\n}`];
  for (let i = 0; i < count; i++) {
    lines.push(
      `function f${String(i)}() {\n  return ${i + 1 < count ? `f${String(i + 1)}()` : "1"};\n}`,
    );
  }
  writeFileSync(path.join(dir, "index.js"), `${lines.join("\n")}\n`);
}

beforeAll(() => {
  const base = mkdtempSync(path.join(tmpdir(), "stateward-library-facts-"));
  project = path.join(base, "app");
  cacheDir = path.join(base, "cache");
  const source = fixture("library-facts");
  cpSync(source, project, { recursive: true });
  cpSync(path.join(source, "packages"), path.join(project, "node_modules"), { recursive: true });
  rmSync(path.join(project, "packages"), { recursive: true, force: true });
  writeLargePackage(project);
  process.env.STATEWARD_PACKAGE_CACHE_DIR = cacheDir;
});

afterAll(() => {
  if (savedCacheDir === undefined) delete process.env.STATEWARD_PACKAGE_CACHE_DIR;
  else process.env.STATEWARD_PACKAGE_CACHE_DIR = savedCacheDir;
  rmSync(path.dirname(project), { recursive: true, force: true });
});

const CONFIG_FACTS: PackageFactsConfig = {
  "config-lib": { go: { throws: ["ConfigError"] }, later: { throws: ["ConfigError"] } },
};

function checker(
  facts: PackageFactsConfig = CONFIG_FACTS,
  rules: Record<string, RuleSetting> = {},
): Checker {
  const parsed = parseConfig({ preset: "recommended", plugins: [errors()], rules, facts }, project);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: project });
}

function hoverOn(target: Checker, name: string): string | undefined {
  const file = path.join(project, "src", "app.ts");
  const at = readFileSync(file, "utf8").indexOf(`function ${name}`) + "function ".length;
  return target.hover(file, at).join("\n\n") || undefined;
}

describe("library facts: where a package's errors come from", () => {
  let target: Checker;
  let findings: readonly Finding[];
  beforeAll(() => {
    forgetPackageFacts();
    target = checker();
    findings = target.check().findings;
  });

  const cases: readonly (readonly [string, string, string])[] = [
    [
      "the config wins over the declaration",
      "useConfig",
      "throws: ConfigError (config-lib 3.0.0: config)",
    ],
    [
      "the config's throws of a promise's function are what it rejects with",
      "useConfigAsync",
      "rejects: ConfigError (config-lib 3.0.0: config)",
    ],
    [
      "a declared @throws wins over the source",
      "useDeclared",
      "throws: DeclaredError (declared-lib 1.2.3: declared)",
    ],
    [
      "a declared @throws on a promise's function",
      "useDeclaredAsync",
      "rejects: DeclaredError (declared-lib 1.2.3: declared) | TypeError (declared-lib 1.2.3: declared)",
    ],
    [
      "inferred from the source, through another file of the package",
      "useInferred",
      "throws: LibError (inferred-lib 2.0.1: inferred) | SyntaxError (inferred-lib 2.0.1: inferred)",
    ],
    ["inferred from CommonJS", "useCommonJs", "throws: RangeError (cjs-lib 0.3.0: inferred)"],
    [
      "inferred, with what it cannot follow",
      "useCallback",
      "throws: others stateward cannot see (from each: inferred-lib 2.0.1: calls a callback)",
    ],
    [
      "not exported by the source",
      "useMissing",
      "throws: others stateward cannot see (from missing: inferred-lib 2.0.1: not found in its source)",
    ],
    [
      "minified",
      "useMinified",
      "throws: others stateward cannot see (from get: minified-lib 4.17.21: minified)",
    ],
    [
      "a native addon",
      "useNative",
      "throws: others stateward cannot see (from hash: native-lib 1.0.0: native addon)",
    ],
    ["eval", "useEval", "throws: others stateward cannot see (from run: eval-lib 0.1.0: eval)"],
    [
      "too large to follow",
      "useLarge",
      "throws: others stateward cannot see (from deep: large-lib 9.9.9: too large to follow)",
    ],
  ];

  it.each(cases)("%s", (_name, fn, expected) => {
    expect(hoverOn(target, fn)).toBe(expected);
  });

  it("shows no hint when the only unknown errors come from library functions, the hover keeps them", () => {
    const file = path.join(project, "src", "app.ts");
    const text = readFileSync(file, "utf8");
    const hinted = target
      .inlayHints(file)
      .filter((hint) => hint.kind === "throws")
      .map((hint) => {
        const before = text.slice(0, hint.offset);
        return `${before.slice(before.lastIndexOf("function ") + "function ".length).split("(")[0] ?? ""}: ${hint.label}`;
      });
    // `useMinified`, `useNative`, `useEval`, `useMissing` and `useLarge` have only library unknowns.
    expect(hinted.filter((one) => /^use(Minified|Native|Eval|Missing|Large)\b/.test(one))).toEqual(
      [],
    );
    expect(hinted).toContain("useMixed: throws (unknown from `external.run`, +1)");
    expect(hoverOn(target, "useMinified")).toContain("minified-lib");
  });

  it("without config facts, the next source answers", () => {
    const plain = checker({});
    plain.check();
    expect(hoverOn(plain, "useConfig")).toBe("throws: TypeError (config-lib 3.0.0: declared)");
  });

  it("catch-misses-error reports a known package error and notes the unknown call", () => {
    const caught = findings.filter((one) => one.ruleId === "errors/catch-misses-error");
    expect(caught).toHaveLength(1);
    const [finding] = caught;
    expect(finding?.message).toBe(
      "this catch does not handle `SyntaxError`, which `load(…)` can throw",
    );
    expect(finding?.kind === "problem" ? finding.related.map((one) => one.message) : []).toEqual([
      "`load(…)` can throw `SyntaxError`",
      "`get` may also throw errors stateward cannot list (minified-lib 4.17.21: minified); rethrow what you do not handle",
    ]);
  });

  it("lists every package called, how its facts are known and why the rest is not", () => {
    expect(target.libraryFacts()).toEqual([
      {
        package: "cjs-lib",
        version: "0.3.0",
        functions: [{ name: "check", source: "inferred", unknown: [] }],
      },
      {
        package: "config-lib",
        version: "3.0.0",
        functions: [
          { name: "go", source: "config", unknown: [] },
          { name: "later", source: "config", unknown: [] },
        ],
      },
      {
        package: "declared-lib",
        version: "1.2.3",
        functions: [
          { name: "fetchIt", source: "declared", unknown: [] },
          { name: "parse", source: "declared", unknown: [] },
        ],
      },
      {
        package: "eval-lib",
        version: "0.1.0",
        functions: [{ name: "run", source: "unknown", unknown: ["eval"] }],
      },
      {
        package: "inferred-lib",
        version: "2.0.1",
        functions: [
          { name: "each", source: "inferred", unknown: ["calls a callback"] },
          { name: "load", source: "inferred", unknown: [] },
          { name: "missing", source: "unknown", unknown: ["not found in its source"] },
        ],
      },
      {
        package: "large-lib",
        version: "9.9.9",
        functions: [{ name: "deep", source: "unknown", unknown: ["too large to follow"] }],
      },
      {
        package: "minified-lib",
        version: "4.17.21",
        functions: [{ name: "get", source: "unknown", unknown: ["minified"] }],
      },
      {
        package: "native-lib",
        version: "1.0.0",
        functions: [{ name: "hash", source: "unknown", unknown: ["native addon"] }],
      },
    ]);
  });
});

describe("library facts: the global cache", () => {
  function entryOf(name: string, version: string): string {
    const dir = path.join(cacheDir, `${name}@${version}`);
    const [file] = readdirSync(dir);
    return path.join(dir, file ?? "");
  }

  it("a second run reads the cache and infers nothing", () => {
    forgetPackageFacts();
    checker().check();
    const first = packageFactsStats();
    forgetPackageFacts();
    const second = checker();
    second.check();
    const after = packageFactsStats();
    expect(after.inferences).toBe(first.inferences);
    expect(after.cacheHits).toBeGreaterThan(first.cacheHits);
    expect(hoverOn(second, "useInferred")).toBe(
      "throws: LibError (inferred-lib 2.0.1: inferred) | SyntaxError (inferred-lib 2.0.1: inferred)",
    );
  });

  it("a corrupt entry is a miss: the facts are computed again and written back", () => {
    const file = entryOf("inferred-lib", "2.0.1");
    writeFileSync(file, "{ not json");
    forgetPackageFacts();
    const before = packageFactsStats().inferences;
    const target = checker();
    target.check();
    expect(packageFactsStats().inferences).toBeGreaterThan(before);
    expect(hoverOn(target, "useInferred")).toBe(
      "throws: LibError (inferred-lib 2.0.1: inferred) | SyntaxError (inferred-lib 2.0.1: inferred)",
    );
    const written: unknown = JSON.parse(readFileSync(file, "utf8"));
    expect(written).toMatchObject({ name: "inferred-lib", version: "2.0.1" });
  });
});

describe("library facts: a package that changes", () => {
  /** A copy of the project of its own: the package is changed in place. */
  let changed = "";
  const lib = (...parts: string[]): string =>
    path.join(changed, "node_modules", "inferred-lib", ...parts);

  function checkerIn(dir: string): Checker {
    const parsed = parseConfig(
      { preset: "recommended", plugins: [errors()], facts: CONFIG_FACTS },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return createChecker({ config: parsed.value, cwd: dir });
  }

  function hoverIn(target: Checker, name: string): string | undefined {
    const file = path.join(changed, "src", "app.ts");
    const at = readFileSync(file, "utf8").indexOf(`function ${name}`) + "function ".length;
    return target.hover(file, at).join("\n\n") || undefined;
  }

  beforeAll(() => {
    changed = mkdtempSync(path.join(path.dirname(project), "changed-"));
    cpSync(project, changed, { recursive: true });
  });

  it("an upgrade while the process runs is read again: new version, new facts", () => {
    forgetPackageFacts();
    const before = checkerIn(changed);
    before.check();
    expect(hoverIn(before, "useInferred")).toBe(
      "throws: LibError (inferred-lib 2.0.1: inferred) | SyntaxError (inferred-lib 2.0.1: inferred)",
    );
    writeFileSync(
      lib("package.json"),
      '{ "name": "inferred-lib", "version": "2.1.0-next", "type": "module", "main": "index.js", "types": "index.d.ts" }\n',
    );
    writeFileSync(
      lib("index.js"),
      readFileSync(lib("index.js"), "utf8").replace(
        'if (text === "") throw new LibError("empty");',
        'if (text === "") throw new LibError("empty");\n  if (text === " ") throw new RangeError("blank");',
      ),
    );
    // The same process (a language server): nothing forgotten.
    const after = checkerIn(changed);
    after.check();
    expect(hoverIn(after, "useInferred")).toBe(
      "throws: LibError (inferred-lib 2.1.0-next: inferred) | RangeError (inferred-lib 2.1.0-next: inferred) | SyntaxError (inferred-lib 2.1.0-next: inferred)",
    );
  });

  it("a file patched under the same package.json makes the cached entry a miss", () => {
    forgetPackageFacts();
    checkerIn(changed).check();
    writeFileSync(
      lib("decode.js"),
      'export function decode(text) {\n  if (text === "?") throw new TypeError("what");\n  return JSON.parse(text);\n}\n',
    );
    // A new process: the global cache has the entry, but its source no longer matches.
    forgetPackageFacts();
    const before = packageFactsStats().inferences;
    const target = checkerIn(changed);
    target.check();
    expect(packageFactsStats().inferences).toBeGreaterThan(before);
    expect(hoverIn(target, "useInferred")).toBe(
      "throws: LibError (inferred-lib 2.1.0-next: inferred) | RangeError (inferred-lib 2.1.0-next: inferred) | SyntaxError (inferred-lib 2.1.0-next: inferred) | TypeError (inferred-lib 2.1.0-next: inferred)",
    );
  });
});
