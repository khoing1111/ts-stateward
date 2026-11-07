import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { expectMessageStandard } from "../src/testing.js";
import { IGNORE_RULE_ID, check, createChecker, emptyCache, parseConfig } from "../src/internal.js";
import { parseSnapshot, toSnapshot } from "../src/internal.js";
import { summaryFromText } from "../src/cache.js";
import type { CheckResult, Plugin, ResultCache, Rule } from "../src/internal.js";

const meta = {
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "d",
} as const;

/** `flag` reports each variable named `bad…`, `maybe` cannot decide on each one named `maybe…`, `fix` is a project rule. */
function declarations(ctx: { sourceFile: ts.SourceFile }): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

function nameOf(declaration: ts.VariableDeclaration): string {
  return ts.isIdentifier(declaration.name) ? declaration.name.text : "";
}

const flag: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const declaration of declarations(ctx)) {
      if (nameOf(declaration).startsWith("bad")) {
        ctx.report({
          node: declaration,
          message: `\`${nameOf(declaration)}\` is bad`,
          hint: "make it good",
        });
      }
    }
  },
};
const other: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const declaration of declarations(ctx)) {
      if (nameOf(declaration).startsWith("worse")) {
        ctx.report({ node: declaration, message: "other problem", hint: "make it good" });
      }
    }
  },
};
const maybe: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const declaration of declarations(ctx)) {
      if (nameOf(declaration).startsWith("maybe")) {
        ctx.unknown({ message: "cannot tell", hint: "add a type", node: declaration });
      }
    }
  },
};
const plugins: Plugin[] = [{ name: "p", description: "p", rules: { flag, other, maybe } }];

let dir = "";
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-ignore-"));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      include: ["*.ts"],
    }),
  );
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function configOf(cwd: string) {
  const parsed = parseConfig({ preset: "recommended", plugins }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

function run(cwd: string, options: { ignores?: false; cache?: ResultCache } = {}): CheckResult {
  return check({ config: configOf(cwd), cwd, ...options });
}

const summary = (result: CheckResult): string[] =>
  result.findings.map((finding) => `${finding.ruleId}: ${finding.message}`);

describe("ignore comments", () => {
  it("covers the finding on the next line, with comment lines in between", () => {
    const cwd = project({
      "a.ts": [
        "// stateward-ignore p/flag: intended",
        "const bad1 = 1;",
        "// stateward-ignore p/flag: intended too",
        "// a note about it",
        "/* and another */",
        "const bad2 = 2;",
        "const bad3 = 3;",
        "",
      ].join("\n"),
    });
    const result = run(cwd);
    expect(summary(result)).toEqual(["p/flag: `bad3` is bad"]);
    expect(result.ignored?.map((entry) => [entry.finding.message, entry.reason])).toEqual([
      ["`bad1` is bad", "intended"],
      ["`bad2` is bad", "intended too"],
    ]);
  });

  it("covers every line of the statement it sits above", () => {
    const cwd = project({
      "a.ts": [
        "// stateward-ignore p/flag: intended",
        "const bad1 = true",
        "  ? { a: 1 }",
        "  : { a: 2 };",
        "const bad2 = 2;",
        "",
      ].join("\n"),
    });
    expect(summary(run(cwd))).toEqual(["p/flag: `bad2` is bad"]);
  });

  it("covers a finding on a later line of a ternary or call that spans lines", () => {
    const cwd = project({
      "a.ts": [
        "declare function pick(...values: number[]): number;",
        "// stateward-ignore p/flag: intended",
        "const fine = pick(",
        "  1,",
        "  ((): number => { const bad1 = 1; return bad1; })(),",
        "  2,",
        ");",
        "const bad2 = 2;",
        "",
      ].join("\n"),
    });
    expect(summary(run(cwd))).toEqual(["p/flag: `bad2` is bad"]);
  });

  it("keeps covering the statement after a formatter moves the comment and wraps the code", () => {
    const before = [
      "// stateward-ignore p/flag: intended",
      "const bad1 = 1 + 2;",
      "const bad2 = 2;",
      "",
    ];
    const after = [
      "// stateward-ignore p/flag: intended",
      "const bad1 =",
      "  1 +",
      "  2;",
      "const bad2 = 2;",
      "",
    ];
    for (const lines of [before, after]) {
      expect(summary(run(project({ "a.ts": lines.join("\n") })))).toEqual([
        "p/flag: `bad2` is bad",
      ]);
    }
  });

  it("covers a whole declaration, but only the head of an if", () => {
    const cwd = project({
      "a.ts": [
        "// stateward-ignore p/flag: intended",
        "function wrap(): number {",
        "  const bad1 = 1;",
        "  return bad1;",
        "}",
        "// stateward-ignore p/flag: head only",
        "if (wrap() > 0) {",
        "  const bad2 = 2;",
        "  wrap();",
        "}",
        "",
      ].join("\n"),
    });
    expect(summary(run(cwd))).toEqual([
      "stateward/ignore: ignore comment is not needed: `p/flag` finds nothing in the code it covers",
      "p/flag: `bad2` is bad",
    ]);
  });

  it("does not reach past a blank line or another line of code", () => {
    const cwd = project({
      "a.ts": [
        "// stateward-ignore p/flag: x",
        "",
        "const bad1 = 1;",
        "// stateward-ignore p/flag: y",
        "const fine = 1;",
        "const bad2 = 2;",
        "",
      ].join("\n"),
    });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "stateward/ignore: ignore comment is not needed: `p/flag` finds nothing in the code it covers",
      "p/flag: `bad1` is bad",
      "stateward/ignore: ignore comment is not needed: `p/flag` finds nothing in the code it covers",
      "p/flag: `bad2` is bad",
    ]);
  });

  it("takes block comments, and a block comment in front of code on its line", () => {
    const cwd = project({
      "a.ts": [
        "/* stateward-ignore p/flag: block */",
        "const bad1 = 1;",
        "/* stateward-ignore p/flag: same line */ const bad2 = 2;",
        "/**",
        " * stateward-ignore p/flag: starred",
        " */",
        "const bad3 = 3;",
        "",
      ].join("\n"),
    });
    const result = run(cwd);
    expect(summary(result)).toEqual([]);
    expect(result.ignored?.map((entry) => entry.reason)).toEqual(["block", "same line", "starred"]);
  });

  it("covers several rules in one comment, each one only for its own findings", () => {
    const cwd = project({
      "a.ts": "// stateward-ignore p/flag, p/other: both\nconst bad1 = 1; const worse1 = 2;\n",
    });
    const result = run(cwd);
    expect(summary(result)).toEqual([]);
    expect(result.ignored).toHaveLength(2);
  });

  it("covers a whole file with the file form before the first statement", () => {
    const cwd = project({
      "a.ts": [
        "// stateward-ignore-file p/flag: generated by our codegen",
        'import "./b.js";',
        "const bad1 = 1;",
        "const bad2 = 2;",
        "const maybe1 = 3;",
        "",
      ].join("\n"),
      "b.ts": "export {};\n",
    });
    const result = run(cwd);
    expect(summary(result)).toEqual(["p/maybe: cannot tell"]);
    expect(result.ignored?.map((entry) => entry.reason)).toEqual([
      "generated by our codegen",
      "generated by our codegen",
    ]);
  });

  it("says the file form does nothing after the first statement", () => {
    const cwd = project({
      "a.ts": "const bad1 = 1;\n// stateward-ignore-file p/flag: too late\nconst bad2 = 2;\n",
    });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "p/flag: `bad1` is bad",
      "stateward/ignore: `stateward-ignore-file` must come before the first statement",
      "p/flag: `bad2` is bad",
    ]);
    expectMessageStandard(result.findings);
  });

  it("still ignores without a reason, and warns", () => {
    const cwd = project({ "a.ts": "// stateward-ignore p/flag\nconst bad1 = 1;\n" });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "stateward/ignore: ignore comment does not say why the case is fine",
    ]);
    expect(result.ignored?.map((entry) => entry.reason)).toEqual([""]);
    expectMessageStandard(result.findings);
    const [only] = result.findings;
    expect(only?.kind === "problem" ? only.severity : "").toBe("warning");
  });

  it("reports an ignore that matches nothing, with a quick fix that removes its line", () => {
    const text = "const a = 1;\n  // stateward-ignore p/flag: gone\nconst fine = 2;\n";
    const cwd = project({ "a.ts": text });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "stateward/ignore: ignore comment is not needed: `p/flag` finds nothing in the code it covers",
    ]);
    expectMessageStandard(result.findings);
    const [finding] = result.findings;
    if (finding?.kind !== "problem") throw new Error("expected a problem");
    const [edit] = finding.fixes[0]?.edits ?? [];
    if (edit === undefined) throw new Error("expected an edit");
    const { start, end } = edit.location;
    expect(text.slice(0, start) + edit.newText + text.slice(end)).toBe(
      "const a = 1;\nconst fine = 2;\n",
    );
  });

  it("removes only the unused rule from a comment that names two", () => {
    const partly = project({
      "a.ts": "// stateward-ignore p/flag, p/maybe: why\nconst bad1 = 1;\n",
    });
    const second = run(partly);
    const [finding] = second.findings;
    if (finding?.kind !== "problem") throw new Error("expected a problem");
    expect(finding.message).toBe(
      "ignore comment is not needed: `p/maybe` finds nothing in the code it covers",
    );
    expect(finding.fixes[0]?.edits[0]?.newText).toBe("// stateward-ignore p/flag: why");
  });

  it("does not judge an ignore for a rule that did not run", () => {
    const cwd = project({ "a.ts": "// stateward-ignore p/flag: why\nconst fine = 1;\n" });
    const parsed = parseConfig({ preset: "recommended", plugins, rules: { "p/flag": "off" } }, cwd);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(check({ config: parsed.value, cwd }).findings).toEqual([]);
  });

  it("makes an unknown rule id an error, with the closest id", () => {
    const cwd = project({ "a.ts": "// stateward-ignore p/flga: why\nconst bad1 = 1;\n" });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "stateward/ignore: `p/flga` is not a stateward rule",
      "p/flag: `bad1` is bad",
    ]);
    expectMessageStandard(result.findings);
    const [finding] = result.findings;
    if (finding?.kind !== "problem") throw new Error("expected a problem");
    expect(finding.severity).toBe("error");
    expect(finding.hint).toBe(
      "write `p/flag`, the rule with the nearest name; until then the comment ignores nothing",
    );
    expect(finding.fixes[0]?.edits[0]?.newText).toBe("p/flag");
  });

  it("does not let an ignore silence the findings about ignores, or a failure", () => {
    const cwd = project({
      "a.ts":
        "// stateward-ignore stateward/ignore: no\n// stateward-ignore p/flag\nconst bad1 = 1;\n",
    });
    const result = run(cwd);
    expect(summary(result)).toEqual([
      "stateward/ignore: `stateward/ignore` findings cannot be ignored",
      "stateward/ignore: ignore comment does not say why the case is fine",
    ]);
    const crash: Rule = {
      kind: "file",
      meta,
      check() {
        throw new Error("boom");
      },
    };
    const crashing: Plugin[] = [{ name: "p", description: "p", rules: { crash } }];
    const parsed = parseConfig({ preset: "recommended", plugins: crashing }, cwd);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const failed = check({ config: parsed.value, cwd });
    expect(failed.findings.map((finding) => finding.kind)).toContain("failure");
  });

  it("ignores an unknown finding and counts it as ignored", () => {
    const cwd = project({
      "a.ts": "// stateward-ignore p/maybe: we know\nconst maybe1 = 1;\nconst maybe2 = 2;\n",
    });
    const result = run(cwd);
    expect(summary(result)).toEqual(["p/maybe: cannot tell"]);
    expect(result.ignored?.map((entry) => entry.finding.kind)).toEqual(["unknown"]);
  });

  it("shows what the comments cover with ignores off, and ignores comments about them", () => {
    const cwd = project({ "a.ts": "// stateward-ignore p/flag\nconst bad1 = 1;\n" });
    const result = run(cwd, { ignores: false });
    expect(summary(result)).toEqual(["p/flag: `bad1` is bad"]);
    expect(result.ignored ?? []).toEqual([]);
  });

  it("ignores a marker that is in a string or a template, not in a comment", () => {
    const cwd = project({
      "a.ts":
        'const text = "// stateward-ignore p/flag: x";\nconst bad1 = `\n// stateward-ignore p/flag: y\n`;\n',
    });
    const result = run(cwd);
    expect(summary(result)).toEqual(["p/flag: `bad1` is bad"]);
  });

  it("is deterministic: the same files give the same findings in the same order", () => {
    const files = {
      "b.ts":
        "// stateward-ignore p/nope: x\nconst bad1 = 1;\n// stateward-ignore p/flag\nconst bad2 = 2;\n",
      "a.ts": "// stateward-ignore p/flag: x\nconst bad1 = 1;\nconst bad2 = 2;\n",
    };
    const first = run(project(files));
    const second = run(dir);
    expect(second.findings).toEqual(first.findings);
    expect(second.ignored).toEqual(first.ignored);
    expect(first.findings.map((finding) => path.basename(finding.location.file))).toEqual([
      "a.ts",
      "b.ts",
      "b.ts",
      "b.ts",
    ]);
  });

  it("has an explain page and messages in the standard", () => {
    const result = run(project({ "a.ts": "// stateward-ignore\nconst a = 1;\n" }));
    expect(summary(result)).toEqual(["stateward/ignore: ignore comment does not name a rule"]);
    expectMessageStandard(result.findings);
    expect(IGNORE_RULE_ID).toBe("stateward/ignore");
  });
});

describe("the ignores options of the config", () => {
  const noReason = "// stateward-ignore p/flag\nconst bad1 = 1;\n";
  const unused = "// stateward-ignore p/flag: gone\nconst fine = 1;\n";

  function runWith(text: string, ignores: Record<string, unknown>): CheckResult {
    const cwd = project({ "a.ts": text });
    const parsed = parseConfig({ preset: "recommended", plugins, ignores }, cwd);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return check({ config: parsed.value, cwd });
  }

  it("accepts an ignore without a reason when requireReason is false", () => {
    const result = runWith(noReason, { requireReason: false });
    expect(summary(result)).toEqual([]);
    expect(result.ignored).toHaveLength(1);
    expect(summary(runWith(noReason, { requireReason: true }))).toHaveLength(1);
  });

  it("reports an ignore that covers nothing as an error, a warning or not at all", () => {
    const severityOf = (reportUnused: string): string[] =>
      runWith(unused, { reportUnused }).findings.map((finding) =>
        finding.kind === "problem" ? finding.severity : finding.kind,
      );
    expect(severityOf("error")).toEqual(["error"]);
    expect(severityOf("warning")).toEqual(["warning"]);
    expect(severityOf("off")).toEqual([]);
  });

  it("keeps the other checks of a comment when the unused report is off", () => {
    const result = runWith("// stateward-ignore p/nope: why\nconst bad1 = 1;\n", {
      reportUnused: "off",
    });
    expect(summary(result)).toContain("stateward/ignore: `p/nope` is not a stateward rule");
  });
});

describe("ignore comments and the cache", () => {
  const text = (reason: string, name = "bad1"): string =>
    `// stateward-ignore p/flag${reason}\nconst ${name} = 1;\nconst bad2 = 2;\n`;

  /** A new process: a new checker on what the last run saved, through JSON as the disk does. */
  function warm(cache: ResultCache): { result: CheckResult; cache: ResultCache } {
    const restored = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache))));
    const result = createChecker({ config: configOf(dir), cwd: dir, cache: restored }).check();
    return { result, cache: restored };
  }

  it("gives the same findings cold and warm, including the unused and no-reason ones", () => {
    const cwd = project({
      "a.ts": text(": why"),
      "b.ts": "// stateward-ignore p/flag\nconst fine = 1;\n",
    });
    const cache = emptyCache();
    const cold = createChecker({ config: configOf(cwd), cwd, cache }).check();
    const plain = run(cwd);
    expect(cold.findings).toEqual(plain.findings);
    expect(summary(cold)).toEqual([
      "p/flag: `bad2` is bad",
      "stateward/ignore: ignore comment does not say why the case is fine",
      "stateward/ignore: ignore comment is not needed: `p/flag` finds nothing in the code it covers",
    ]);
    const second = warm(cache);
    expect(second.result.findings).toEqual(cold.findings);
    expect(second.result.ignored).toEqual(cold.ignored);
    expect(second.cache.changed).toBe(false);
    const third = warm(second.cache);
    expect(third.result.findings).toEqual(cold.findings);
  });

  it("sees an edit of only the comment, warm", () => {
    const cwd = project({ "a.ts": text("") });
    const cache = emptyCache();
    const cold = createChecker({ config: configOf(cwd), cwd, cache }).check();
    expect(summary(cold)).toEqual([
      "stateward/ignore: ignore comment does not say why the case is fine",
      "p/flag: `bad2` is bad",
    ]);
    writeFileSync(path.join(cwd, "a.ts"), text(": now with a reason"));
    const edited = warm(cache);
    expect(summary(edited.result)).toEqual(["p/flag: `bad2` is bad"]);
    expect(edited.result.ignored?.map((entry) => entry.reason)).toEqual(["now with a reason"]);
    writeFileSync(path.join(cwd, "a.ts"), "const bad1 = 1;\nconst bad2 = 2;\n");
    const removed = warm(edited.cache);
    expect(summary(removed.result)).toEqual(["p/flag: `bad1` is bad", "p/flag: `bad2` is bad"]);
    expect(removed.result.ignored).toEqual([]);
  });

  it("reads the comments again when a cache entry for them is broken", () => {
    const cwd = project({ "a.ts": text(": why") });
    const cache = emptyCache();
    const cold = createChecker({ config: configOf(cwd), cwd, cache }).check();
    for (const [file, entry] of cache.files) {
      const broken = { findings: [], summary: summaryFromText('[{"start":"x"}]', "h") };
      const rules = new Map([...entry.rules, ["stateward/ignore-comments", broken]]);
      cache.files.set(file, { fingerprint: entry.fingerprint, rules, reads: entry.reads });
    }
    const again = createChecker({ config: configOf(cwd), cwd, cache }).check();
    expect(again.findings).toEqual(cold.findings);
    expect(again.ignored).toEqual(cold.ignored);
  });

  it("marks the ignored findings of the fast pass the same way", () => {
    const cwd = project({ "a.ts": text(": why") });
    const checker = createChecker({ config: configOf(cwd), cwd });
    const file = path.join(cwd, "a.ts");
    const fast = checker.checkFiles([file]);
    expect(summary(fast)).toEqual(["p/flag: `bad2` is bad"]);
    expect(fast.ignored).toHaveLength(1);
  });
});
