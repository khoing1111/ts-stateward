import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, OptionValue, RuleConfig, RuleSetting } from "@stateward/core";
import { ownership } from "../src/index.js";

const RULES = ["state-written-outside-owner", "brand-built-outside-owner"] as const;

export type RuleKey = (typeof RULES)[number];

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** Runs the pack with every rule but `rule` off, so a fixture is judged by one rule. */
export function checkOnly(dir: string, rule: RuleKey): readonly Finding[] {
  const settings: Record<string, RuleSetting> = {};
  for (const other of RULES) if (other !== rule) settings[`ownership/${other}`] = "off";
  const { findings } = checkFixture(dir, [ownership()], settings);
  expectMessageStandard(findings);
  return findings;
}

/** As `checkOnly`, with the rule given these options. */
export function checkWith(
  dir: string,
  rule: RuleKey,
  options: Readonly<Record<string, OptionValue>>,
): readonly Finding[] {
  const settings: Record<string, RuleConfig> = { [`ownership/${rule}`]: ["error", options] };
  for (const other of RULES) if (other !== rule) settings[`ownership/${other}`] = "off";
  const { findings } = checkFixture(dir, [ownership()], settings);
  expectMessageStandard(findings);
  return findings;
}

/** The parts of a finding a message test compares: its file in the fixture, headline and fix line. */
export type Shown = { file: string; message: string; hint: string };

export function shown(dir: string, findings: readonly Finding[]): Shown[] {
  return findings.map((finding) => ({
    file: path.relative(dir, finding.location.file).split(path.sep).join("/"),
    message: finding.message,
    hint: finding.hint,
  }));
}

export function says(file: string, message: string, hint: string): Shown {
  return { file, message, hint };
}

/**
 * The fix of a brand built outside its owner: the way to build it, then the `owners` reading, with
 * the option as it is written (the brand's name, the file from the project's folder).
 */
export function ways(first: string, brand: string, file: string): string {
  return [
    "one of",
    `- ${first}`,
    `- or, if this file checks the value itself, list it under the rule's \`owners\` option for \`${brand}\`:`,
    `    { owners: { ${JSON.stringify(brand)}: [${JSON.stringify(file)}] } }`,
  ].join("\n");
}
