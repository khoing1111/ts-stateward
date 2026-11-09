import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, FixForm, TextEdit } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { ownership } from "../src/index.js";
import { OPAQUE_TEXT } from "../src/declare-owned.js";
import { fixture } from "./helpers.js";

const SLOW = 120_000;
const FIXTURE = fixture("opaque-fix");
const STATE = 'State `Positive` opaque: `Opaque<number, "Positive">`';

let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "stateward-opaque-fix-")));
  cpSync(FIXTURE, dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function src(file: string): string {
  return path.join(dir, "src", file);
}

/** The findings of the brand rule, with only the fixes that compile. */
function reviewed(): Finding[] {
  const parsed = parseConfig(
    {
      preset: "recommended",
      plugins: [ownership()],
      rules: { "ownership/state-written-outside-owner": "off" },
    },
    dir,
  );
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

describe("ownership/brand-built-outside-owner: stating an unmarked brand opaque", () => {
  it(
    "rewrites the brand with `Opaque`, writes the marker, compiles, and the brand is then strict",
    { timeout: SLOW },
    () => {
      const fix = onlyFix(reviewed());
      expect(fix.title).toBe(STATE);
      apply(fix.edits);
      expect(typeErrors(dir)).toBe("");
      expect(readFileSync(src("values.ts"), "utf8")).toContain(
        'export type Positive = Opaque<number, "Positive">;',
      );
      expect(readFileSync(src("guarantees.ts"), "utf8")).toContain(OPAQUE_TEXT);
      const after = reviewed();
      expect(after.map((finding) => finding.message)).toEqual([
        "`Positive` is built without its check",
      ]);
      expect(
        after[0]?.kind === "problem" ? after[0].related.map((note) => note.message) : [],
      ).toEqual(["`Positive` is stated `Opaque` here"]);
      // Stated, the brand offers no fix to state it again.
      expect(after[0]?.kind === "problem" ? after[0].fixes : []).toEqual([]);
    },
  );
});
