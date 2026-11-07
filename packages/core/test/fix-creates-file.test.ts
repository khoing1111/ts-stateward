import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "../src/internal.js";
import type { FileRule, FixForm } from "../src/internal.js";
import { meta, plugin } from "./probe-plugin.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-creates-"));
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
const helper = path.join(dir, "helper.ts").replaceAll("\\", "/");
writeFileSync(file, "export const value = 1;\n");

/** Each form imports `twice` from a helper file it writes; only the second writes one that compiles. */
const HELPERS = [
  "export const twice = (n: number): string => n * 2;\n",
  "export const twice = (n: number): number => n * 2;\n",
];

const writesHelper: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const [statement] = ctx.sourceFile.statements;
    if (statement === undefined || !ts.isVariableStatement(statement)) return;
    const forms = HELPERS.map((text, i): FixForm => ({
      title: `use the helper (${String(i + 1)})`,
      edits: [
        { location: { file: helper, start: 0, end: 0 }, newText: text },
        {
          location: { file: ctx.file, start: 0, end: statement.end },
          newText: 'import { twice } from "./helper";\nexport const value = twice(1);',
        },
      ],
    }));
    const [first, ...alternatives] = forms;
    if (first === undefined) return;
    ctx.report({
      node: statement,
      message: "value",
      hint: "use the helper",
      fixes: [{ ...first, alternatives }],
    });
  },
};

describe("a fix that writes a new file", () => {
  it("is tried with the file in place, and its errors in that file count against it", () => {
    const parsed = parseConfig(
      { plugins: [plugin({ writesHelper })], rules: { "probe/writesHelper": "warning" } },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    const [review] = checker.reviewFixes(checker.check().findings);
    expect(review?.rejected.map((rejected) => rejected.title)).toEqual(["use the helper (1)"]);
    const finding = review?.finding;
    const offered = finding?.kind === "problem" ? finding.fixes : [];
    expect(offered.map((fix) => fix.title)).toEqual(["use the helper (2)"]);
    // Trying it wrote nothing.
    expect(existsSync(helper)).toBe(false);
  });
});
