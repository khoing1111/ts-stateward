import { randomUUID } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** One replacement in a copy of a fixture: the text from `start` to `end` of `file` becomes `text`. */
export type Replacement = { file: string; start: number; end: number; text: string };

/**
 * Runs `then` on a copy of the fixture `dir` with the replacements made, and removes the copy. The
 * copy is a sibling folder, so a tsconfig that points at `../../stubs` still finds them.
 */
export function inCopy<T>(
  dir: string,
  replacements: readonly Replacement[],
  then: (copy: string) => T,
): T {
  const copy = `${dir}-copy-${randomUUID().slice(0, 8)}`;
  try {
    cpSync(dir, copy, { recursive: true });
    const files = new Set(replacements.map((one) => one.file));
    for (const file of files) {
      const target = path.join(copy, path.relative(dir, file));
      const text = readFileSync(target, "utf8");
      const mine = replacements
        .filter((one) => one.file === file)
        .sort((a, b) => b.start - a.start);
      writeFileSync(
        target,
        mine.reduce((out, one) => out.slice(0, one.start) + one.text + out.slice(one.end), text),
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

/** A JSON list of strings, read from the text a hint shows; throws on anything else. */
export function stringList(text: string): string[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || !value.every((one): one is string => typeof one === "string")) {
    throw new Error(`not a list of strings: ${text}`);
  }
  return value;
}
