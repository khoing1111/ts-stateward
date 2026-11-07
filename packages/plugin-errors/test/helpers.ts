import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, RuleConfig, RuleSetting } from "@stateward/core";
import { errors } from "../src/index.js";

const RULES = [
  "catch-hides-unexpected",
  "finally-can-throw",
  "catch-misses-error",
  "throws-doc-mismatch",
  "render-throw-without-boundary",
  "must-handle-error",
  "result-ignored",
  "result-unchecked",
  "narrow-try",
] as const;

/** The pack's add-ons, on in every fixture: a fixture is judged by one rule either way. */
export const ADDONS = ["errors/narrow-try"] as const;

export type RuleKey = (typeof RULES)[number];

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** One pack for the whole file, so `checkFixture` answers a repeated question from its cache. */
const pack = errors();

/** Runs the pack with every rule but `rule` off, so a fixture is judged by one rule. */
export function checkOnly(dir: string, rule: RuleKey): readonly Finding[] {
  const settings: Record<string, RuleSetting> = {};
  for (const other of RULES) if (other !== rule) settings[`errors/${other}`] = "off";
  const { findings } = checkFixture(dir, [pack], settings, ADDONS);
  expectMessageStandard(findings);
  return findings;
}

/** As `checkOnly`, with the rule set as the config says (a severity and options). */
export function checkWith(dir: string, rule: RuleKey, setting: RuleConfig): readonly Finding[] {
  const settings: Record<string, RuleConfig> = { [`errors/${rule}`]: setting };
  for (const other of RULES) if (other !== rule) settings[`errors/${other}`] = "off";
  const { findings } = checkFixture(dir, [pack], settings, ADDONS);
  expectMessageStandard(findings);
  return findings;
}

/** `severity line:message` per problem, `unknown line:message` per unknown: what an option test compares. */
export function brief(findings: readonly Finding[]): string[] {
  return findings.map((finding) => {
    const label = finding.kind === "problem" ? finding.severity : finding.kind;
    return `${label} ${path.basename(finding.location.file)}: ${finding.message}`;
  });
}

/** The parts of a finding a message test compares: the file, headline and fix text. */
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
