import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, FixForm, TextEdit } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";
import { GUARANTEES_TEXT } from "../src/provider-missing/declare-fix.js";

const SLOW = 300_000;
const FIXTURE = fileURLToPath(new URL("./fixtures/declare-guarded", import.meta.url));
/** Under the package, so the copy resolves React from the package's own node_modules. */
const SCRATCH = fileURLToPath(new URL("../.scratch/guarantee-fixes", import.meta.url));
const DECLARE = "Declare AuthCtx required: requiredContext<User>()";

let dir = "";

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  dir = mkdtempSync(path.join(SCRATCH, "app-"));
  cpSync(FIXTURE, dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function checker() {
  const parsed = parseConfig({ preset: "recommended", plugins: [reactContext()] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir, cache: false });
}

/** The findings of a full check, with only the fixes that compile. */
function reviewed(): Finding[] {
  const check = checker();
  return check.reviewFixes(check.check().findings).map((review) => review.finding);
}

function src(file: string): string {
  return path.join(dir, "src", file);
}

/** Writes every edit to disk; an edit in a file that does not exist creates it. */
function apply(edits: readonly TextEdit[]): void {
  const byFile = new Map<string, TextEdit[]>();
  for (const edit of edits) {
    byFile.set(edit.location.file, [...(byFile.get(edit.location.file) ?? []), edit]);
  }
  for (const [file, list] of byFile) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const next = [...list]
      .sort((a, b) => b.location.start - a.location.start)
      .reduce(
        (result, edit) =>
          result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
        text,
      );
    writeFileSync(file, next);
  }
}

function onlyFix(finding: Finding | undefined): FixForm {
  if (finding?.kind !== "problem") throw new Error("expected a problem");
  const [fix] = finding.fixes;
  if (fix === undefined) throw new Error(`no fix offered for ${finding.message}`);
  return fix;
}

/** The findings as `<rule> <file>: <message>`. */
function summary(findings: readonly Finding[]): string[] {
  return findings.map(
    (finding) =>
      `${finding.ruleId} ${path.relative(dir, finding.location.file).split(path.sep).join("/")}: ${finding.message}`,
  );
}

describe("react-context: stating a guarded context required", () => {
  it(
    "writes the guarantees file once, rewrites the declaration, and it compiles",
    { timeout: SLOW },
    () => {
      const finding = reviewed().find((one) => one.ruleId === "react-context/provider-missing");
      const fix = onlyFix(finding);
      expect(fix.title).toBe(DECLARE);
      // The declaration, the new import, the import it leaves unused, and the new file.
      expect(fix.edits.map((edit) => path.basename(edit.location.file)).sort()).toEqual([
        "contexts.ts",
        "contexts.ts",
        "contexts.ts",
        "guarantees.ts",
      ]);
      apply(fix.edits);
      expect(readFileSync(src("guarantees.ts"), "utf8")).toBe(GUARANTEES_TEXT);
      expect(readFileSync(src("contexts.ts"), "utf8")).toBe(
        [
          'import { requiredContext } from "./guarantees";',
          "",
          "export type User = { name: string };",
          "",
          "export const AuthCtx = requiredContext<User>();",
          "",
        ].join("\n"),
      );
      expect(typeErrors(dir)).toBe("");
      // Now proven strictly: the missing Provider is an error that names the stated declaration,
      // the helper's cast is not a placeholder, and the hook keeps its check while a reader fails.
      const after = reviewed();
      expect(summary(after)).toEqual([
        "react-context/provider-missing src/main.tsx: `<Profile>` is rendered without `AuthCtx.Provider`",
      ]);
      const [error] = after;
      expect(error?.kind === "problem" ? error.related.at(-1)?.message : "").toBe(
        "`AuthCtx` is stated required: every reader must be proven under its Provider",
      );
    },
  );

  it(
    "drops the hook's check once every reader is proven, and it compiles",
    { timeout: SLOW },
    () => {
      apply(onlyFix(reviewed()[0]).edits);
      const main = readFileSync(src("main.tsx"), "utf8");
      writeFileSync(src("main.tsx"), main.replace("    <Profile />\n  </>", "  </>"));
      const findings = reviewed();
      expect(summary(findings)).toEqual([
        "react-context/provider-missing src/useAuth.ts: `useAuth` checks `AuthCtx` at run time, but every reader is proven under its Provider",
      ]);
      const fix = onlyFix(findings[0]);
      expect(fix.title).toBe("Drop the check in useAuth");
      apply(fix.edits);
      expect(readFileSync(src("useAuth.ts"), "utf8")).not.toContain("throw");
      expect(typeErrors(dir)).toBe("");
      expect(reviewed()).toEqual([]);
    },
  );

  it(
    "is offered at the declaration with no finding, importing a guarantees file that exists",
    { timeout: SLOW },
    () => {
      writeFileSync(src("guarantees.ts"), GUARANTEES_TEXT);
      const check = checker();
      check.check();
      const contexts = readFileSync(src("contexts.ts"), "utf8");
      const at = contexts.indexOf("createContext<");
      const actions = check.refactors(src("contexts.ts"), at, at);
      expect(actions.map((action) => action.title)).toEqual([DECLARE]);
      const edits = actions.flatMap((action) => action.edits);
      // The file exists: it is imported, not written again.
      expect(edits.every((edit) => path.basename(edit.location.file) === "contexts.ts")).toBe(true);
      apply(edits);
      expect(typeErrors(dir)).toBe("");
      expect(check.refactors(src("contexts.ts"), 0, 0)).toEqual([]);
    },
  );
});
