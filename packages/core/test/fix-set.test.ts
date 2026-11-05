import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { createChecker, emptyCache, parseConfig } from "../src/internal.js";
import type { Checker, FileRule, FixForm, TextEdit } from "../src/internal.js";
import { meta, plugin } from "./probe-plugin.js";

/**
 * two fixes that each replace one use of an imported type leave the
 * import unused only together (TS6196 with `noUnusedLocals`), and a fix that alone leaves an
 * import unused was rejected instead of removing it.
 */
const dir = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-set-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
writeFileSync(
  path.join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "es2022",
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      noUnusedLocals: true,
    },
    include: ["*.ts"],
  }),
);
writeFileSync(
  path.join(dir, "types.ts"),
  [
    "export type FilterDictionary = Record<string, string>;",
    "export type Labels = Record<string, string>;",
    "",
  ].join("\n"),
);
const files = {
  // Two tables share the import: only both fixes together leave it unused.
  "two.ts": [
    'import type { FilterDictionary } from "./types";',
    "",
    'export const sortFilters: FilterDictionary = { name: "Name" };',
    'export const viewFilters: FilterDictionary = { grid: "Grid" };',
    "",
  ].join("\n"),
  // One table: its fix alone leaves the import unused, so it removes it.
  "one.ts": [
    'import type { FilterDictionary } from "./types";',
    "",
    'export const sortFilters: FilterDictionary = { name: "Name" };',
    "",
  ].join("\n"),
  // The other name of the import is still used: only the fixed one goes.
  "shared.ts": [
    'import type { FilterDictionary, Labels } from "./types";',
    "",
    'export const sortFilters: FilterDictionary = { name: "Name" };',
    'export const labels: Labels = { idle: "Idle" };',
    "",
  ].join("\n"),
};
for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);

/** Moves the `FilterDictionary` annotation behind the table as `satisfies`, like the table rule. */
const satisfying: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const statement of ctx.sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const [declaration] = statement.declarationList.declarations;
      const { type, initializer } = declaration ?? {};
      if (declaration === undefined || type === undefined || initializer === undefined) continue;
      if (type.getText(ctx.sourceFile) !== "FilterDictionary") continue;
      const fix: FixForm = {
        title: "use satisfies",
        changesType: true,
        edits: [
          { location: { file: ctx.file, start: declaration.name.end, end: type.end }, newText: "" },
          {
            location: { file: ctx.file, start: initializer.end, end: initializer.end },
            newText: ` satisfies Record<${initializer.getText(ctx.sourceFile).includes("name") ? '"name"' : '"grid"'}, string>`,
          },
        ],
      };
      ctx.report({ node: declaration.name, message: "table", hint: "use satisfies", fixes: [fix] });
    }
  },
};

function apply(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.location.start - a.location.start)) {
    out = out.slice(0, edit.location.start) + edit.newText + out.slice(edit.location.end);
  }
  return out;
}

function checkerFor(): Checker {
  const parsed = parseConfig(
    { plugins: [plugin({ satisfying })], rules: { "probe/satisfying": "warning" } },
    dir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir, cache: emptyCache() });
}

function offeredIn(checker: Checker, name: string): FixForm[] {
  const findings = checker
    .check()
    .findings.filter((finding) => path.basename(finding.location.file) === name);
  return checker
    .reviewFixes(findings)
    .flatMap((review) => (review.finding.kind === "problem" ? review.finding.fixes : []));
}

const text = (name: string): string => readFileSync(path.join(dir, name), "utf8");

describe("verifyFixSet: fixes applied together", () => {
  it("removes an import that two fixes leave unused only together", () => {
    const checker = checkerFor();
    const offered = offeredIn(checker, "two.ts");
    expect(offered).toHaveLength(2);
    // Alone, each fix leaves the other table's use: nothing to remove.
    expect(offered.map((form) => form.importCleanup)).toEqual([undefined, undefined]);
    const set = checker.verifyFixSet(offered);
    expect(set.kept).toEqual([true, true]);
    expect(apply(text("two.ts"), set.edits)).toBe(
      [
        "",
        'export const sortFilters = { name: "Name" } satisfies Record<"name", string>;',
        'export const viewFilters = { grid: "Grid" } satisfies Record<"grid", string>;',
        "",
      ].join("\n"),
    );
  });

  it("gives a fix that alone leaves an import unused the edit that removes it", () => {
    const checker = checkerFor();
    const [form] = offeredIn(checker, "one.ts");
    expect(form?.importCleanup).toHaveLength(1);
    expect(apply(text("one.ts"), form?.edits ?? [])).toBe(
      [
        "",
        'export const sortFilters = { name: "Name" } satisfies Record<"name", string>;',
        "",
      ].join("\n"),
    );
    // In a set, the removal is made once, for the set.
    const set = checker.verifyFixSet(form === undefined ? [] : [form]);
    expect(set.kept).toEqual([true]);
    expect(apply(text("one.ts"), set.edits)).toBe(apply(text("one.ts"), form?.edits ?? []));
  });

  it("removes only the name left unused from an import that binds others", () => {
    const checker = checkerFor();
    const [form] = offeredIn(checker, "shared.ts");
    expect(apply(text("shared.ts"), form?.edits ?? [])).toBe(
      [
        'import type { Labels } from "./types";',
        "",
        'export const sortFilters = { name: "Name" } satisfies Record<"name", string>;',
        'export const labels: Labels = { idle: "Idle" };',
        "",
      ].join("\n"),
    );
  });

  it("makes an edit two fixes share once", () => {
    const checker = checkerFor();
    const file = path.join(dir, "shared.ts");
    const shared: TextEdit = { location: { file, start: 0, end: 0 }, newText: "// note\n" };
    const set = checker.verifyFixSet([
      { title: "a", edits: [shared] },
      { title: "b", edits: [{ ...shared, location: { ...shared.location } }] },
    ]);
    expect(set.kept).toEqual([true, true]);
    expect(set.edits).toHaveLength(1);
  });
});
