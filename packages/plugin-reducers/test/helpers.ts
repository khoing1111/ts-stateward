import { randomUUID } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, RuleConfig } from "@stateward/core";
import { reducers } from "../src/index.js";

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The findings of the pack over a fixture project, each already held to the message standard. */
export function check(dir: string, rules: Record<string, RuleConfig> = {}): readonly Finding[] {
  const { findings } = checkFixture(dir, [reducers()], rules);
  expectMessageStandard(findings);
  return findings;
}

/** The parts of a finding a message test compares. */
export type Shown = {
  rule: string;
  severity: string;
  file: string;
  /** The code the finding points at. */
  at: string;
  message: string;
  hint: string;
  notes: string[];
  fixes: string[];
};

const read = (file: string): string => readFileSync(file, "utf8");

export function shown(dir: string, findings: readonly Finding[]): Shown[] {
  const relative = (file: string): string => path.relative(dir, file).split(path.sep).join("/");
  return findings.map((finding) => ({
    rule: finding.ruleId,
    severity: finding.kind === "problem" ? finding.severity : finding.kind,
    file: relative(finding.location.file),
    at: read(finding.location.file).slice(finding.location.start, finding.location.end),
    message: finding.message,
    hint: finding.hint,
    notes:
      finding.kind === "problem"
        ? finding.related.map(
            (related) =>
              `${relative(related.location.file)}: ${read(related.location.file).slice(related.location.start, related.location.end)}: ${related.message}`,
          )
        : [],
    fixes:
      finding.kind === "problem"
        ? finding.fixes.map((fix) =>
            fix.edits
              .map(
                (edit) =>
                  `${relative(edit.location.file)}@${String(edit.location.start)}: ${edit.newText}`,
              )
              .join(" | "),
          )
        : [],
  }));
}

/** One replacement in a copy of a fixture: the text from `start` to `end` of `file` becomes `text`. */
export type Replacement = { file: string; start: number; end: number; text: string };

/**
 * Runs `then` on a copy of the fixture `dir` with the replacements made (offsets are those of the
 * original files), and removes the copy. The copy is a sibling folder, so what the project's
 * `node_modules` and tsconfig reach from there still resolves.
 */
export function inCopy<T>(
  dir: string,
  replacements: readonly Replacement[],
  then: (copy: string) => T,
): T {
  const copy = `${dir}-copy-${randomUUID().slice(0, 8)}`;
  try {
    cpSync(dir, copy, { recursive: true });
    for (const file of new Set(replacements.map((one) => one.file))) {
      const target = path.join(copy, path.relative(dir, file));
      const mine = replacements
        .filter((one) => one.file === file)
        .sort((a, b) => b.start - a.start);
      writeFileSync(
        target,
        mine.reduce(
          (out, one) => out.slice(0, one.start) + one.text + out.slice(one.end),
          readFileSync(target, "utf8"),
        ),
      );
    }
    return then(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** The example lines of a hint: each run of lines indented 4 spaces is one block, without the indent. */
export function exampleBlocks(hint: string): string[][] {
  const blocks: string[][] = [];
  let open = false;
  for (const line of hint.split("\n")) {
    if (line.startsWith("    ")) {
      if (!open) blocks.push([]);
      blocks.at(-1)?.push(line.slice(4));
      open = true;
    } else open = false;
  }
  return blocks;
}
