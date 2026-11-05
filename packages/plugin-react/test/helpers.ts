import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, Plugin, RuleConfig } from "@stateward/core";
import { react } from "../src/index.js";

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The findings of the pack over a fixture project, each already held to the message standard. */
export function check(
  dir: string,
  rules: Record<string, RuleConfig> = {},
  plugins: readonly Plugin[] = [react()],
  addons: readonly string[] = [],
): readonly Finding[] {
  const { findings } = checkFixture(dir, plugins, rules, addons);
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
