import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { createChecker, emptyCache, parseConfig } from "../src/internal.js";
import type { FileRule, FixForm } from "../src/internal.js";
import { meta, plugin } from "./probe-plugin.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-review-type-"));
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
writeFileSync(
  path.join(dir, "a.ts"),
  [
    "const narrowed: { n: number } = { n: 1 };",
    "const loose: { n: number } = { n: 2 };",
    "",
    "export const total: number = narrowed.n + loose.n;",
    "",
  ].join("\n"),
);

/** Makes `n` optional in each annotation; the fix for `narrowed` says it changes a type. */
const retyping: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    for (const statement of ctx.sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const [declaration] = statement.declarationList.declarations;
      const type = declaration?.type;
      if (declaration === undefined || type === undefined || !ts.isIdentifier(declaration.name)) {
        continue;
      }
      const name = declaration.name.text;
      if (name === "total") continue;
      const fix: FixForm = {
        title: `retype ${name}`,
        edits: [
          {
            location: { file: ctx.file, start: type.getStart(ctx.sourceFile), end: type.end },
            newText: "{ n?: number }",
          },
        ],
        ...(name === "narrowed" ? { changesType: true } : {}),
      };
      ctx.report({ node: declaration.name, message: name, hint: `retype ${name}`, fixes: [fix] });
    }
  },
};

describe("reviewFixes: a fix that changes a declaration's type", () => {
  it("is rejected for an error it causes on another line of the file; a plain fix is judged by its lines", () => {
    const parsed = parseConfig(
      { plugins: [plugin({ retyping })], rules: { "probe/retyping": "warning" } },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: emptyCache() });
    const reviews = checker.reviewFixes(checker.check().findings);
    const offered = Object.fromEntries(
      reviews.map((review) => [
        review.finding.message,
        review.finding.kind === "problem" ? review.finding.fixes.map((fix) => fix.title) : [],
      ]),
    );
    expect(offered).toEqual({ narrowed: [], loose: ["retype loose"] });
    const narrowed = reviews.find((review) => review.finding.message === "narrowed");
    expect(narrowed?.rejected).toEqual([
      { title: "retype narrowed", reason: "'narrowed.n' is possibly 'undefined'." },
    ]);
  });
});
