import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, RuleConfig } from "@stateward/core";
import { ownership } from "../src/index.js";

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The findings of the pack over a fixture project, each already held to the message standard. */
export function check(dir: string, rules: Record<string, RuleConfig> = {}): readonly Finding[] {
  const { findings } = checkFixture(dir, [ownership()], rules);
  expectMessageStandard(findings);
  return findings;
}

/** The parts of a finding a message test compares. */
export type Shown = {
  file: string;
  /** The code the finding points at. */
  at: string;
  message: string;
  hint: string;
  notes: string[];
};

export function shown(dir: string, findings: readonly Finding[]): Shown[] {
  return findings.map((finding) => {
    const text = readFileSync(finding.location.file, "utf8");
    return {
      file: path.relative(dir, finding.location.file).split(path.sep).join("/"),
      at: text.slice(finding.location.start, finding.location.end),
      message: finding.message,
      hint: finding.hint,
      notes:
        finding.kind === "problem"
          ? finding.related.map((related) => {
              const declared = readFileSync(related.location.file, "utf8");
              return `${declared.slice(related.location.start, related.location.end)}: ${related.message}`;
            })
          : [],
    };
  });
}
