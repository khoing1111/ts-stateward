import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  createChecker,
  emptyCache,
  parseConfig,
  parseSnapshot,
  stronglyConnectedComponents,
  toSnapshot,
} from "../src/internal.js";
import type { Json, Plugin, ResultCache, Rule } from "../src/internal.js";
import { fixturePath, posix } from "./fixture-path.js";

const dir = fixturePath("deps");
const file = (name: string): string => path.join(dir, name);
const meta = {
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "d",
} as const;

/** A file rule that reports the literal type of each exported `const`, and counts where it ran. */
function literalProbe(ran: string[]): Rule {
  return {
    kind: "file",
    meta,
    check(ctx) {
      ran.push(path.basename(ctx.file));
      for (const statement of ctx.sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const literals = ctx.types.literalsOf(declaration.name);
          const labels = literals === "not-finite" ? "not-finite" : literals.map((l) => l.label);
          ctx.report({ node: declaration.name, message: String(labels), hint: "h" });
        }
      }
    },
  };
}

function checkerOf(rules: Record<string, Rule>, cache?: ResultCache, cwd = dir) {
  const plugins: Plugin[] = [{ name: "p", description: "p", rules }];
  const parsed = parseConfig({ preset: "recommended", plugins }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({
    config: parsed.value,
    cwd,
    ...(cache === undefined ? {} : { cache }),
  });
}

const messages = (result: {
  findings: readonly { message: string; location: { file: string } }[];
}) => result.findings.map((f) => `${path.basename(f.location.file)}: ${f.message}`);

describe("the result cache", () => {
  it("runs a rule again on a file only when the file or something it imports changed", () => {
    const ran: string[] = [];
    const checker = checkerOf({ literals: literalProbe(ran) });
    const first = checker.check();
    expect(messages(first)).toEqual(['c.ts: "green","red"', "d.ts: 1"]);
    expect(ran.sort()).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);

    ran.length = 0;
    const again = checker.check();
    expect([again.findings, again.hidden]).toEqual([first.findings, first.hidden]);
    expect(ran).toEqual([]);

    // An unrelated file: only it runs again.
    checker.check(new Map([[file("d.ts"), "export const unrelated = 2;\n"]]));
    expect(ran).toEqual(["d.ts"]);

    // A file two imports away: the type it defines reaches c.ts through b.ts.
    ran.length = 0;
    const edited = checker.check(
      new Map([
        [file("d.ts"), "export const unrelated = 2;\n"],
        [file("a.ts"), 'export type Color = "red" | "green" | "blue";\n'],
      ]),
    );
    expect(ran.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(messages(edited)).toEqual(['c.ts: "blue","green","red"', "d.ts: 2"]);
  });

  it("checks a project rule's summaries again only when one of them changed", () => {
    let checks = 0;
    const lengths: Rule = {
      kind: "project",
      meta,
      summarize: ({ sourceFile }) => (sourceFile.text.includes("blue") ? "blue" : "plain"),
      check(summaries, ctx) {
        checks++;
        for (const [summarized, summary] of summaries) {
          if (summary === "blue") {
            ctx.report({
              message: "blue",
              hint: "h",
              location: { file: summarized, start: 0, end: 0 },
            });
          }
        }
      },
    };
    const checker = checkerOf({ lengths });
    expect(messages(checker.check())).toEqual([]);
    expect(checks).toBe(1);
    // d.ts is summarized again, to the same summary: the check does not run.
    checker.check(new Map([[file("d.ts"), "export const unrelated = 3;\n"]]));
    expect(checks).toBe(1);
    const blue = checker.check(new Map([[file("d.ts"), 'export const unrelated = "blue";\n']]));
    expect(checks).toBe(2);
    expect(messages(blue)).toEqual(["d.ts: blue"]);
  });

  it("keeps one copy of a summary that a file summarized again to the same value", () => {
    const seen: Json[] = [];
    const shapes: Rule = {
      kind: "project",
      meta,
      summarize: ({ sourceFile }) => ({ blue: sourceFile.text.includes("blue"), tags: ["t"] }),
      check(summaries) {
        const summary = summaries.get(posix(file("d.ts")));
        if (summary !== undefined) seen.push(summary);
      },
    };
    const cache = emptyCache();
    const checker = checkerOf({ shapes }, cache);
    checker.check();
    // d.ts runs again (its text changed) to the same summary; c.ts's change makes the check run.
    checker.check(
      new Map([
        [file("d.ts"), "export const unrelated = 3;\n"],
        [file("c.ts"), 'export const blue = "blue";\n'],
      ]),
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    // The parsed summary is saved as the text it was parsed from.
    const saved = Object.values(toSnapshot(cache).files[posix(file("d.ts"))]?.rules ?? {}).flatMap(
      (rule) => (rule.summary === undefined ? [] : [rule.summary]),
    );
    expect(saved).toContain('{"blue":false,"tags":["t"]}');
  });

  it("does not keep the result of a rule that threw", () => {
    let calls = 0;
    const flaky: Rule = {
      kind: "file",
      meta,
      check(ctx) {
        if (!ctx.file.endsWith("d.ts")) return;
        calls++;
        if (calls === 1) throw new Error("once");
      },
    };
    const checker = checkerOf({ flaky });
    expect(checker.check().findings.map((f) => f.kind)).toEqual(["failure"]);
    expect(checker.check().findings).toEqual([]);
    expect(calls).toBe(2);
  });

  it("gives the same findings from a snapshot read back from JSON", () => {
    const cache = emptyCache();
    const ran: string[] = [];
    const first = checkerOf({ literals: literalProbe(ran) }, cache).check();
    expect(cache.changed).toBe(true);
    const restored = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache))));
    ran.length = 0;
    const again = checkerOf({ literals: literalProbe(ran) }, restored).check();
    expect(ran).toEqual([]);
    expect(restored.changed).toBe(false);
    expect(again.findings).toEqual(first.findings);
  });

  it("reads a broken or foreign snapshot as an empty cache, never as no findings", () => {
    for (const broken of [null, 3, { format: 999 }, { format: 1, files: { a: 1 }, projects: {} }]) {
      const cache = parseSnapshot(broken);
      expect(cache.files.size).toBe(0);
      expect(cache.projects.size).toBe(0);
    }
    const ran: string[] = [];
    const tampered = emptyCache();
    checkerOf({ literals: literalProbe(ran) }, tampered).check();
    const snapshot = toSnapshot(tampered);
    const [first] = Object.values(snapshot.files);
    const [rule] = Object.values(first?.rules ?? {});
    if (rule === undefined) throw new Error("expected a cached rule result");
    Reflect.set(rule, "findings", [{ kind: "problem" }]);
    expect(parseSnapshot(snapshot).files.size).toBe(0);
  });

  it("keys a result by how the config runs the rule, so another severity misses", () => {
    const ran: string[] = [];
    const cache = emptyCache();
    checkerOf({ literals: literalProbe(ran) }, cache).check();
    ran.length = 0;
    const plugins: Plugin[] = [
      { name: "p", description: "p", rules: { literals: literalProbe(ran) } },
    ];
    const parsed = parseConfig(
      { preset: "recommended", plugins, rules: { "p/literals": "warning" } },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    createChecker({ config: parsed.value, cwd: dir, cache }).check();
    expect(ran.sort()).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });
});

describe("the result cache across runs: a recorded program", () => {
  let copy = "";
  afterEach(() => {
    rmSync(copy, { recursive: true, force: true });
  });

  /** A run as a new process makes it: a new checker on the cache the last run left. */
  function runOn(cache: ResultCache, ran: string[]) {
    const result = checkerOf({ literals: literalProbe(ran) }, cache, copy).check();
    const fresh = checkerOf({ literals: literalProbe([]) }, undefined, copy).check();
    expect([result.findings, result.hidden]).toEqual([fresh.findings, fresh.hidden]);
    return result;
  }

  it("answers an unchanged project without running a rule, and sees every change on disk", () => {
    copy = mkdtempSync(path.join(tmpdir(), "stateward-record-"));
    cpSync(dir, copy, { recursive: true });
    writeFileSync(
      path.join(copy, "e.ts"),
      'import { later } from "./lib/later.js";\nexport const e = later;\n',
    );
    const cache = emptyCache();
    const ran: string[] = [];
    runOn(cache, ran);
    expect(cache.programs.size).toBe(1);

    ran.length = 0;
    runOn(cache, ran);
    expect(ran).toEqual([]);

    // A file two imports away changes on disk.
    writeFileSync(path.join(copy, "a.ts"), 'export type Color = "red" | "blue";\n');
    runOn(cache, ran);
    expect(ran.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);

    // A new file that an import was looking for, outside the tsconfig's files (so the program's
    // root files are the same): only the host's answer for that path tells.
    ran.length = 0;
    mkdirSync(path.join(copy, "lib"));
    writeFileSync(path.join(copy, "lib", "later.ts"), 'export const later = "now" as const;\n');
    const resolved = runOn(cache, ran);
    expect(ran).toContain("e.ts");
    expect(resolved.findings.map((f) => f.message)).toContain('"now"');
  });
});

describe("the result cache across runs: an editor's open files", () => {
  let copy = "";
  afterEach(() => {
    rmSync(copy, { recursive: true, force: true });
  });

  /** The cache as a new process reads it from disk. */
  const restored = (cache: ResultCache): ResultCache =>
    parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache))));

  it("answers an open, unchanged file's fast pass from the cache without running a rule, and an edited one fresh", () => {
    copy = mkdtempSync(path.join(tmpdir(), "stateward-open-"));
    cpSync(dir, copy, { recursive: true });
    const c = path.join(copy, "c.ts");
    const a = path.join(copy, "a.ts");
    // The editor's open document holds the text on disk.
    const open = new Map([[c, readFileSync(c, "utf8")]]);
    const cache = emptyCache();
    checkerOf({ literals: literalProbe([]) }, cache, copy).check(open);
    // Built on the open document's text, the program is recorded all the same.
    expect(cache.programs.size).toBe(1);

    /** A checker with no cache: what a cold start finds. */
    const cold = () => checkerOf({ literals: literalProbe([]) }, undefined, copy);
    const ran: string[] = [];
    const warm = restored(cache);
    const editor = checkerOf({ literals: literalProbe(ran) }, warm, copy);
    const fast = editor.checkFiles([c], open, [c]);
    expect(ran).toEqual([]);
    expect(fast.findings).toEqual(cold().checkFiles([c], open).findings);
    expect(messages(fast)).toEqual(['c.ts: "green","red"']);
    // The full pass after it reuses everything: the recorded program is replayed with the open
    // text, so nothing is built or recorded again (the cache has nothing new to save).
    const full = editor.check(open);
    expect(ran).toEqual([]);
    const coldFull = cold().check(open);
    expect([full.findings, full.hidden]).toEqual([coldFull.findings, coldFull.hidden]);
    expect(warm.changed).toBe(false);

    // A file it imports through b.ts is edited in another document: c.ts, unedited, runs again.
    const edited = new Map([...open, [a, 'export type Color = "red" | "green" | "blue";\n']]);
    const again = checkerOf({ literals: literalProbe(ran) }, restored(cache), copy);
    const fresh = again.checkFiles([c, a], edited, [c]);
    expect(ran.sort()).toEqual(["a.ts", "c.ts"]);
    expect(fresh.findings).toEqual(cold().checkFiles([c, a], edited).findings);
    expect(messages(fresh)).toEqual(['c.ts: "blue","green","red"']);
  });
});

describe("the result cache across runs: the package a declaration belongs to", () => {
  let project = "";
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  /** Reports the package (`packageOf`) of each name a file imports, and counts where it ran. */
  function packageProbe(ran: string[]): Rule {
    return {
      kind: "file",
      meta,
      check(ctx) {
        ran.push(path.basename(ctx.file));
        for (const statement of ctx.sourceFile.statements) {
          const bindings = ts.isImportDeclaration(statement)
            ? statement.importClause?.namedBindings
            : undefined;
          if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
          for (const element of bindings.elements) {
            const symbol = ctx.types.symbolAt(element.name);
            const declaration = symbol && ctx.types.declarationOf(symbol);
            const name = declaration && ctx.types.packageOf(declaration.file);
            ctx.report({ node: element, message: name ?? "none", hint: "h" });
          }
        }
      },
    };
  }

  function write(relative: string, text: string): void {
    const target = path.join(project, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }

  it("sees a renamed package whose declarations kept their text", () => {
    project = mkdtempSync(path.join(tmpdir(), "stateward-package-"));
    write(
      "tsconfig.json",
      '{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler"},"include":["src"]}',
    );
    write("src/use.ts", 'import { x } from "lib";\nexport const y = x;\n');
    write("node_modules/lib/package.json", '{"name":"lib-a","types":"index.d.ts"}');
    write("node_modules/lib/index.d.ts", "export declare const x: 1;\n");
    // A package.json without a name (as in a dist folder) is passed over.
    write("node_modules/lib/types/package.json", '{"type":"module"}');

    const cache = emptyCache();
    const run = (ran: string[]) => {
      const result = checkerOf({ names: packageProbe(ran) }, cache, project).check();
      const fresh = checkerOf({ names: packageProbe([]) }, undefined, project).check();
      expect(result.findings).toEqual(fresh.findings);
      return result.findings.map((finding) => finding.message);
    };
    const ran: string[] = [];
    expect(run(ran)).toEqual(["lib-a"]);
    ran.length = 0;
    expect(run(ran)).toEqual(["lib-a"]);
    expect(ran).toEqual([]);

    write("node_modules/lib/package.json", '{"name":"lib-b","types":"index.d.ts"}');
    expect(run(ran)).toEqual(["lib-b"]);
    expect(ran).toEqual(["use.ts"]);
  });
});

describe("stronglyConnectedComponents", () => {
  it("puts a cycle in one component and every component after the ones it reaches", () => {
    const edges: Record<string, string[]> = {
      a: ["b"],
      b: ["c", "a"],
      c: [],
      d: ["a", "e"],
      e: [],
    };
    expect(stronglyConnectedComponents(["a", "b", "c", "d", "e"], (n) => edges[n] ?? [])).toEqual([
      ["c"],
      ["a", "b"],
      ["e"],
      ["d"],
    ]);
  });

  it("follows a chain longer than the call stack", () => {
    const n = 100_000;
    const nodes = Array.from({ length: n }, (_, i) => i);
    const components = stronglyConnectedComponents(nodes, (i) => (i + 1 < n ? [i + 1] : []));
    expect(components.length).toBe(n);
    expect(components[0]).toEqual([n - 1]);
  });
});

describe("a file with a syntax error", () => {
  let project = "";
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("gets one unknown finding, the same on a run from a restored cache", () => {
    project = mkdtempSync(path.join(tmpdir(), "stateward-syntax-"));
    writeFileSync(path.join(project, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(path.join(project, "ok.ts"), "export const ok = 1;\n");
    writeFileSync(path.join(project, "bad.ts"), "export const bad = ;\nexport const x = 1;\n");
    const cache = emptyCache();
    const first = checkerOf({}, cache, project).check();
    expect(first.findings).toHaveLength(1);
    const [found] = first.findings;
    expect(found).toMatchObject({
      kind: "unknown",
      ruleId: "stateward/syntax",
      message: "not checked: `bad.ts`: it has a syntax error",
      hint: "fix the syntax error at line 1:20 (Expression expected.), then check again",
    });
    expect(found?.location.start).toBe(19);

    const restored = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache))));
    const again = checkerOf({}, restored, project).check();
    expect(again.findings).toEqual(first.findings);
    expect(restored.changed).toBe(false);
    expect(checkerOf({}, undefined, project).check().findings).toEqual(first.findings);
  });
});

describe("a file whose imports do not resolve", () => {
  let project = "";
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("gets one unknown at the first unresolved import, the same from a restored cache", () => {
    project = mkdtempSync(path.join(tmpdir(), "stateward-imports-"));
    writeFileSync(path.join(project, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(path.join(project, "styles.d.ts"), 'declare module "*.css";\n');
    writeFileSync(
      path.join(project, "ok.ts"),
      'import "./a.css";\nimport s from "./b.css";\nexport const ok = s;\n',
    );
    writeFileSync(
      path.join(project, "bad.ts"),
      'import { a } from "@tldraw/editor";\nimport { b } from "also-missing";\nexport const x = [a, b];\n',
    );
    const cache = emptyCache();
    const first = checkerOf({}, cache, project).check();
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]).toMatchObject({
      kind: "unknown",
      ruleId: "stateward/imports",
      message: "not checked: code using `@tldraw/editor`: the package is not installed",
      hint: "install the project's packages (or build its workspace packages) and check again; 1 more unresolved in the file",
    });
    expect(first.findings[0]?.location.start).toBe(18);
    const restored = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache))));
    const again = checkerOf({}, restored, project).check();
    expect(again.findings).toEqual(first.findings);
    expect(restored.changed).toBe(false);
    expect(checkerOf({}, undefined, project).check().findings).toEqual(first.findings);
  });
});

describe("the wording of an imports unknown", () => {
  let project = "";
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  function findingsOf(files: Record<string, string>): readonly { message: string; hint: string }[] {
    project = mkdtempSync(path.join(tmpdir(), "stateward-imports-words-"));
    writeFileSync(path.join(project, "tsconfig.json"), '{ "include": ["**/*.ts"] }\n');
    mkdirSync(path.join(project, "node_modules", "legacy-chart"), { recursive: true });
    writeFileSync(
      path.join(project, "node_modules", "legacy-chart", "index.js"),
      "module.exports = {};\n",
    );
    writeFileSync(
      path.join(project, "node_modules", "legacy-chart", "package.json"),
      '{ "name": "legacy-chart", "main": "index.js" }\n',
    );
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      writeFileSync(path.join(project, file), text);
    }
    return checkerOf({}, undefined, project).check().findings;
  }

  it("says an untyped JavaScript module has no types, not that it does not resolve", () => {
    const [found] = findingsOf({
      "chart.ts": 'import c from "legacy-chart";\nexport const x = c;\n',
    });
    expect(found?.message).toBe("not checked: code using `legacy-chart`: it has no types");
    expect(found?.hint).toBe("install its types (`@types/legacy-chart`) or declare the module");
  });

  it("keeps the headline within 100 characters: the file is left to the location, the specifier shortened", () => {
    const dir = "a-very-long-folder-name/another-very-long-folder-name/and-one-more-folder";
    const [noPath] = findingsOf({
      [`${dir}/x.ts`]: 'import { a } from "@tldraw/editor";\nexport const x = a;\n',
    });
    expect(noPath?.message).toBe(
      "not checked: code using `@tldraw/editor`: the package is not installed",
    );
    const specifier = `@scope/${"very-long-package-name-".repeat(5)}end`;
    const [shortened] = findingsOf({
      [`${dir}/y.ts`]: `import { a } from "${specifier}";\nexport const y = a;\n`,
    });
    expect(shortened?.message.length).toBeLessThanOrEqual(100);
    expect(shortened?.message).toContain("…");
    expect(shortened?.message.endsWith(": the package is not installed")).toBe(true);
  });
});
