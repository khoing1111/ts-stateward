import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import {
  createChecker,
  emptyCache,
  parseConfig,
  parseSnapshot,
  toSnapshot,
} from "../src/internal.js";
import type { FileRule, Finding, FixForm, ResultCache } from "../src/internal.js";
import { meta, plugin } from "./probe-plugin.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-review-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
writeFileSync(
  path.join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { strict: true, target: "es2022", module: "esnext", noEmit: true },
    include: ["*.ts"],
  }),
);
const file = path.join(dir, "a.ts").replaceAll("\\", "/");
writeFileSync(
  file,
  [
    "export const good = 1;",
    "export const bad = 2;",
    "export const twice = 3;",
    "export const broken = 4;",
    "export const plain = 5;",
    "export const left = 6;",
    "export const right = 7;",
    "export const pre: string = 8;",
    "",
  ].join("\n"),
);

/** The forms of the fix each `const` gets: each inserts its text after the declaration. */
const FORMS: Readonly<Record<string, readonly string[]>> = {
  good: ["\nexport const goodCopy: number = good;"],
  bad: ["\nexport const badCopy: string = bad;"],
  twice: ["\nexport const twiceCopy: string = twice;", "\nexport const twiceCopy: number = twice;"],
  broken: ["\nexport const = broken;"],
  // Each compiles alone; together they declare `shared` twice.
  left: ["\nexport const shared = left;"],
  right: ["\nexport const shared = right;"],
  // On a line that already has an error: the fix does not add it.
  pre: [" // checked"],
};

const fixing: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const statement of ctx.sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const [declaration] = statement.declarationList.declarations;
      if (declaration === undefined || !ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      const forms = (FORMS[name] ?? []).map((newText, i): FixForm => ({
        title: `copy ${name} (${String(i + 1)})`,
        safe: true,
        edits: [
          { location: { file: ctx.file, start: statement.end, end: statement.end }, newText },
        ],
      }));
      const [first, ...alternatives] = forms;
      ctx.report({
        node: declaration.name,
        message: `const ${name}`,
        hint: `copy ${name}`,
        ...(first === undefined
          ? {}
          : { fixes: [alternatives.length > 0 ? { ...first, alternatives } : first] }),
      });
    }
  },
};

function newChecker(cache: ResultCache | false = emptyCache()) {
  const parsed = parseConfig(
    { plugins: [plugin({ fixing })], rules: { "probe/fixing": "warning" } },
    dir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir, cache });
}

function byName(findings: readonly Finding[], name: string): Finding {
  const found = findings.find((finding) => finding.message === `const ${name}`);
  if (found === undefined) throw new Error(`no finding for ${name}`);
  return found;
}

function titles(finding: Finding): readonly string[] {
  return finding.kind === "problem" ? finding.fixes.map((fix) => fix.title) : [];
}

describe("reviewFixes", () => {
  const cache = emptyCache();
  const checker = newChecker(cache);
  const { findings } = checker.check();
  const reviews = checker.reviewFixes(findings);
  const reviewOf = (name: string) => {
    const review = reviews[findings.indexOf(byName(findings, name))];
    if (review === undefined) throw new Error(`no review for ${name}`);
    return review;
  };

  it("offers a fix that compiles, unchanged", () => {
    const review = reviewOf("good");
    expect(titles(review.finding)).toEqual(["copy good (1)"]);
    expect(review.finding.hint).toBe("copy good");
    expect(review.rejected).toEqual([]);
  });

  it("does not offer a fix that adds a type error, and says why in the hint", () => {
    const review = reviewOf("bad");
    expect(titles(review.finding)).toEqual([]);
    expect(review.rejected).toEqual([
      { title: "copy bad (1)", reason: "Type 'number' is not assignable to type 'string'." },
    ]);
    expect(review.finding.hint).toBe(
      "copy bad\nno automatic fix: Type 'number' is not assignable to type 'string'.",
    );
  });

  it("does not offer a fix that does not parse", () => {
    const review = reviewOf("broken");
    expect(titles(review.finding)).toEqual([]);
    expect(review.rejected.map((entry) => entry.title)).toEqual(["copy broken (1)"]);
    expect(review.finding.hint).toMatch(/^copy broken\nno automatic fix: /);
  });

  it("offers the first alternative that compiles", () => {
    const review = reviewOf("twice");
    expect(titles(review.finding)).toEqual(["copy twice (2)"]);
    expect(review.rejected.map((entry) => entry.title)).toEqual(["copy twice (1)"]);
    const [fix] = review.finding.kind === "problem" ? review.finding.fixes : [];
    expect(fix).not.toHaveProperty("alternatives");
    expect(review.finding.hint).toBe("copy twice");
  });

  it("tries again alone a fix that broke only next to another", () => {
    expect(titles(reviewOf("left").finding)).toEqual(["copy left (1)"]);
    expect(titles(reviewOf("right").finding)).toEqual(["copy right (1)"]);
  });

  it("does not blame a fix for an error its line already had", () => {
    expect(titles(reviewOf("pre").finding)).toEqual(["copy pre (1)"]);
  });

  it("leaves a finding without fixes as it is", () => {
    const finding = byName(findings, "plain");
    expect(reviewOf("plain")).toEqual({ finding, unchecked: [], rejected: [] });
  });

  it("keeps verdicts in the cache and answers from it", () => {
    // good, bad, broken, left, right, pre, and both forms of twice.
    expect(cache.verdicts.size).toBe(8);
    // A verdict in the cache is taken as it is: no program is built to try the fix again.
    for (const key of cache.verdicts.keys())
      cache.verdicts.set(key, { kind: "breaks", error: "kept" });
    const again = newChecker(cache);
    const fresh = again.check().findings;
    const review = again.reviewFixes([byName(fresh, "good")])[0];
    expect(review?.rejected).toEqual([{ title: "copy good (1)", reason: "kept" }]);
  });

  it("keeps verdicts and alternatives on disk", () => {
    const stored = emptyCache();
    stored.verdicts.set("a", { kind: "compiles" });
    stored.verdicts.set("b", { kind: "breaks", error: "no" });
    const back = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(stored))));
    expect([...back.verdicts]).toEqual([...stored.verdicts]);
    const twice = byName(findings, "twice");
    const entry = {
      fingerprint: "f",
      rules: new Map([["k", { findings: [twice] }]]),
      reads: new Map(),
    };
    stored.files.set(file, entry);
    const kept = parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(stored))));
    expect(kept.files.get(file)?.rules.get("k")?.findings).toEqual([twice]);
  });

  it("does not reuse a verdict once the file changed", () => {
    const own = newChecker(emptyCache());
    const edited = "export const good = 1;\nexport const goodCopy = 0;\n";
    const fresh = own.check(new Map([[file, edited]])).findings;
    // The fix now declares `goodCopy` a second time.
    const review = own.reviewFixes([byName(fresh, "good")])[0];
    expect(review?.rejected).toEqual([
      { title: "copy good (1)", reason: "Cannot redeclare block-scoped variable 'goodCopy'." },
    ]);
  });

  it("works without a cache", () => {
    const own = newChecker(false);
    const fresh = own.check().findings;
    const [review] = own.reviewFixes([byName(fresh, "good")]);
    expect(
      review?.finding.kind === "problem" ? review.finding.fixes.map((f) => f.title) : [],
    ).toEqual(["copy good (1)"]);
  });
});

describe("reviewFixes in a project that installs a package twice", () => {
  // `x` and `y` each bring their own copy of `dup@1.0.0`: TypeScript reads the second copy as a
  // redirect to the first, which the program built to try a fix must not be handed.
  const twice = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-review-dup-"));
  afterAll(() => {
    rmSync(twice, { recursive: true, force: true });
  });
  const write = (relative: string, text: string): void => {
    const target = path.join(twice, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { strict: true, target: "es2022", module: "esnext", noEmit: true },
      include: ["*.ts"],
    }),
  );
  for (const user of ["x", "y"]) {
    write(`node_modules/${user}/package.json`, JSON.stringify({ name: user, version: "1.0.0" }));
    write(`node_modules/${user}/index.d.ts`, 'export { Dup } from "dup";\n');
    write(
      `node_modules/${user}/node_modules/dup/package.json`,
      JSON.stringify({ name: "dup", version: "1.0.0" }),
    );
    write(`node_modules/${user}/node_modules/dup/index.d.ts`, "export type Dup = number;\n");
  }
  write(
    "a.ts",
    'import type { Dup } from "x";\nimport type { Dup as Same } from "y";\nexport const good: Dup | Same = 1;\n',
  );

  it("tries the fix", () => {
    const parsed = parseConfig(
      { plugins: [plugin({ fixing })], rules: { "probe/fixing": "warning" } },
      twice,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: twice, cache: false });
    const { findings } = checker.check();
    const [review] = checker.reviewFixes([byName(findings, "good")]);
    expect(review?.rejected).toEqual([]);
    expect(review === undefined ? [] : titles(review.finding)).toEqual(["copy good (1)"]);
  });
});
