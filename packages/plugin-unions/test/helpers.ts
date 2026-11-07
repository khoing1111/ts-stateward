import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, RuleConfig, TextEdit } from "@stateward/core";
import { unions } from "../src/index.js";

const RULES = ["default-hides-cases", "tag-does-not-discriminate", "if-chain-misses-case"] as const;

/** The pack has no add-ons left; kept so fixtures read the same way. */
export const ADDONS: readonly string[] = [];

export type RuleKey = (typeof RULES)[number];

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** One pack for the whole file, so `checkFixture` answers a repeated question from its cache. */
const pack = unions();

/**
 * Runs the pack with every rule but `rule` off, so a fixture is judged by one rule; `setting`
 * gives that rule a severity and options.
 */
export function checkOnly(dir: string, rule: RuleKey, setting?: RuleConfig): readonly Finding[] {
  const settings: Record<string, RuleConfig> = {};
  for (const other of RULES) if (other !== rule) settings[`unions/${other}`] = "off";
  if (setting !== undefined) settings[`unions/${rule}`] = setting;
  const { findings } = checkFixture(dir, [pack], settings, ADDONS);
  expectMessageStandard(findings);
  return findings;
}

/** The parts of a finding a message test compares: the file, headline and fix line. */
export type Shown = { file: string; message: string; hint: string };

export function shown(findings: readonly Finding[]): Shown[] {
  return findings.map((finding) => ({
    file: path.basename(finding.location.file),
    message: finding.message,
    hint: finding.hint,
  }));
}

export function says(file: string, message: string, hint: string): Shown {
  return { file, message, hint };
}

/** Applies the edits of a fix to the text, last first so earlier offsets stay valid. */
export function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

/** The type errors of each text, as `tsc` prints them (computed in this process). */
export { typeErrorsOfTexts as typeErrorsOf } from "@stateward/core/testing";
