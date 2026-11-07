import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, FixForm, TextEdit } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { ownership } from "../src/index.js";
import { GUARANTEES_TEXT, OWNED_TEXT } from "../src/declare-owned.js";
import { fixture } from "./helpers.js";

const SLOW = 120_000;
const FIXTURE = fixture("declare-owned");
const DECLARE = "Declare settings owned by src/settings.ts";
const MARKED =
  'export const settings: Owned<{ theme: string; fontSize: number; }> = { theme: "light", fontSize: 14 };';

let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "stateward-declare-owned-")));
  cpSync(FIXTURE, dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function src(file: string): string {
  return path.join(dir, "src", file);
}

/** The findings of a full check, with only the fixes that compile. */
function reviewed(): Finding[] {
  const parsed = parseConfig({ preset: "recommended", plugins: [ownership()] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
  return checker.reviewFixes(checker.check().findings).map((review) => review.finding);
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

function onlyFix(findings: readonly Finding[]): FixForm {
  const [finding] = findings;
  if (finding?.kind !== "problem") throw new Error("expected a problem");
  const [fix] = finding.fixes;
  if (fix === undefined) throw new Error(`no fix offered for ${finding.message}`);
  return fix;
}

/** Applies the offered fix, and checks it compiles and the value is then proven strictly. */
function declareAndProve(): void {
  const fix = onlyFix(reviewed());
  expect(fix.title).toBe(DECLARE);
  apply(fix.edits);
  expect(typeErrors(dir)).toBe("");
  expect(readFileSync(src("settings.ts"), "utf8")).toContain(MARKED);
  const after = reviewed();
  expect(after.map((finding) => finding.message)).toEqual([
    "`settings` is changed outside its owner, `src/settings.ts`",
  ]);
  expect(after[0]?.hint).toBe("call `setTheme` from `src/settings.ts` instead: it owns the value");
}

describe("ownership/state-written-outside-owner: declaring a value owned", () => {
  it(
    "writes the guarantees file when there is none, marks the declaration, and it compiles",
    { timeout: SLOW },
    () => {
      declareAndProve();
      expect(readFileSync(src("guarantees.ts"), "utf8")).toBe(GUARANTEES_TEXT);
      expect(readFileSync(src("settings.ts"), "utf8")).toBe(
        [
          'import type { Owned } from "./guarantees";',
          "",
          MARKED,
          "",
          "export function setTheme(theme: string): void {",
          "  settings.theme = theme;",
          "}",
          "",
        ].join("\n"),
      );
    },
  );

  it("adds `Owned` to a guarantees file that does not have it", { timeout: SLOW }, () => {
    const other = 'export type Other<T> = T & { readonly __guarantee?: "other" };\n';
    writeFileSync(src("guarantees.ts"), other);
    declareAndProve();
    expect(readFileSync(src("guarantees.ts"), "utf8")).toBe(`${OWNED_TEXT}\n${other}`);
  });

  it("only imports `Owned` from a guarantees file that has it", { timeout: SLOW }, () => {
    writeFileSync(src("guarantees.ts"), GUARANTEES_TEXT);
    declareAndProve();
    expect(readFileSync(src("guarantees.ts"), "utf8")).toBe(GUARANTEES_TEXT);
  });
});
