import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseConfig } from "./config.js";
import { check } from "./checker.js";
import { IMPORTS_RULE_ID } from "./engine.js";
import { codeOf } from "./lazy.js";
import type { CheckResult, Finding, Plugin, Rule, RuleConfig } from "./types.js";

/** Plugin fixtures are broken on purpose, so a config that fails to parse is the author's bug. */
export class FixtureConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureConfigError";
  }
}

type CachedCheck = {
  plugins: readonly Plugin[];
  rules: string;
  signature: string;
  result: CheckResult;
};

/** Results by project folder, per test file (vitest gives each file its own module instance). */
const checkCache = new Map<string, CachedCheck[]>();

/** Every file's path, size and modification time under `dir`: it changes when the project does. */
function signatureOf(dir: string): string {
  const parts: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else {
        const stats = statSync(entryPath);
        parts.push(`${entryPath}:${String(stats.size)}:${String(stats.mtimeMs)}`);
      }
    }
  };
  visit(dir);
  return parts.join("\n");
}

function samePlugins(a: readonly Plugin[], b: readonly Plugin[]): boolean {
  return a.length === b.length && a.every((plugin, index) => plugin === b[index]);
}

/**
 * Checks the project in `dir` (it needs a tsconfig.json) with just `plugins`, the `recommended`
 * preset (a rule's tests judge it as most teams turn it on) and the `addons` named
 * "<plugin>/<addon>". Checking the same
 * folder again with the same plugin objects and rule settings, while no file in it changed,
 * returns the earlier result, so a test file asking many questions of one fixture checks it once.
 * Plugins built anew for each call (`guards()`) are never matched: a test of determinism that
 * does that always checks again.
 */
export function checkFixture(
  dir: string,
  plugins: readonly Plugin[],
  rules: Record<string, RuleConfig> = {},
  addons: readonly string[] = [],
): CheckResult {
  const key = path.resolve(dir);
  const rulesKey = JSON.stringify({ rules, addons });
  const signature = signatureOf(key);
  const known = checkCache.get(key) ?? [];
  const hit = known.find(
    (entry) =>
      entry.rules === rulesKey &&
      entry.signature === signature &&
      samePlugins(entry.plugins, plugins),
  );
  if (hit !== undefined) return hit.result;
  const parsed = parseConfig({ plugins, preset: "recommended", rules, addons }, dir);
  if (!parsed.ok) throw new FixtureConfigError(parsed.errors.join("\n"));
  const checked = check({ config: parsed.value, cwd: dir });
  // A fixture is a small project without node_modules, so its `react` import never resolves; the
  // unknown for that (`stateward/imports`) is tested with `check`, not in every rule's fixtures.
  const result = {
    ...checked,
    findings: checked.findings.filter((finding) => finding.ruleId !== IMPORTS_RULE_ID),
  };
  checkCache.set(key, [...known, { plugins, rules: rulesKey, signature, result }]);
  return result;
}

/**
 * The code of one rule of a plugin, with its `explain` text and its kind. A lazy rule must be
 * loaded already: the test setup (vitest.setup.ts) loads every pack's rules before a test file
 * runs, as `loadConfigFile` loads the rules a config turns on.
 */
export function ruleCode<P extends Plugin>(
  plugin: P,
  key: Extract<keyof P["rules"], string>,
): Rule {
  const rule = plugin.rules[key];
  if (rule === undefined) throw new FixtureConfigError(`${plugin.name} has no rule "${key}"`);
  return codeOf(`${plugin.name}/${key}`, rule);
}

const MAX_HEADLINE_LENGTH = 100;
const MAX_HINT_LENGTH = 140;
/** A hint may follow its line with a code example: this many lines, each indented, this long. */
const MAX_EXAMPLE_LINES = 4;
const MAX_EXAMPLE_LENGTH = 100;
const MIN_EXAMPLE_INDENT = 4;

/** The line with every quoted name (code in backticks) taken out: the words around them. */
function withoutNames(line: string): string {
  return line.replace(/`[^`]*`/g, "");
}

/** The words of one line of a fix, its names left out, must fit the fix line's limit. */
function wordsProblems(label: string, line: string): string[] {
  const words = withoutNames(line);
  return words.length > MAX_HINT_LENGTH
    ? [
        `${label} words are ${String(words.length)} characters without its names; at most ${String(MAX_HINT_LENGTH)}`,
      ]
    : [];
}

/** A code example: up to four lines, each indented 4 spaces and at most 100 characters. */
function exampleProblems(example: readonly string[]): string[] {
  const problems: string[] = [];
  if (example.length > MAX_EXAMPLE_LINES) {
    problems.push(
      `fix hint example has ${String(example.length)} lines; at most ${String(MAX_EXAMPLE_LINES)}`,
    );
  }
  for (const line of example) {
    if (!line.startsWith(" ".repeat(MIN_EXAMPLE_INDENT))) {
      problems.push(
        `fix hint example line "${line}" must be indented by ${String(MIN_EXAMPLE_INDENT)} spaces`,
      );
    }
    if (line.length > MAX_EXAMPLE_LENGTH) {
      problems.push(
        `fix hint example line is ${String(line.length)} characters; at most ${String(MAX_EXAMPLE_LENGTH)}`,
      );
    }
  }
  return problems;
}

/**
 * A hint is one line, or one line and an indented code example of up to four lines (M2). With
 * several ways to fix (M22) it is `one of`, then one `- ` line per way, each starting with its
 * action in lowercase and every one after the first with `or`, each with its own example.
 */
function hintProblems(hint: string): string[] {
  const [first = "", ...rest] = hint.split(/\r?\n/);
  const problems = lineProblems("fix hint", first, undefined);
  problems.push(...wordsProblems("fix hint", first));
  if (!rest.some((line) => line.startsWith("- "))) return [...problems, ...exampleProblems(rest)];
  if (first !== "one of") problems.push('a fix hint with ways to fix must start with "one of"');
  const ways: { line: string; example: string[] }[] = [];
  for (const line of rest) {
    const last = ways.at(-1);
    if (line.startsWith("- ")) ways.push({ line, example: [] });
    else if (last === undefined) problems.push(`fix hint line "${line}" must follow a way to fix`);
    else last.example.push(line);
  }
  if (ways.length < 2) problems.push('a fix hint with "one of" needs two ways to fix or more');
  ways.forEach((way, index) => {
    const text = way.line.slice(2);
    problems.push(...wordsProblems("fix hint way", text), ...exampleProblems(way.example));
    if (!/^[a-z]/.test(text)) problems.push(`fix hint way "${text}" must start in lowercase`);
    if (index > 0 && !/^or\b/.test(text)) {
      problems.push(`fix hint way "${text}" must start with "or"`);
    }
  });
  return problems;
}

function lineProblems(label: string, text: string, maxLength: number | undefined): string[] {
  const problems: string[] = [];
  if (text.trim().length === 0) problems.push(`${label} is empty`);
  if (/[\r\n]/.test(text)) problems.push(`${label} must be one line`);
  if (maxLength !== undefined && text.length > maxLength) {
    problems.push(`${label} is ${String(text.length)} characters; at most ${String(maxLength)}`);
  }
  return problems;
}

/**
 * The violations of the communication standard in one finding;
 * empty when the finding is fine.
 */
export function messageProblems(finding: Finding): readonly string[] {
  // The limit is "about 100": a headline over it passes only when its own words, with every
  // quoted name taken out, still fit; a name is never cut to make a line short.
  const words = withoutNames(finding.message);
  const problems = [
    ...lineProblems("headline", finding.message, undefined),
    ...(words.length > MAX_HEADLINE_LENGTH
      ? [
          `headline words are ${String(words.length)} characters without its names; at most ${String(MAX_HEADLINE_LENGTH)}`,
        ]
      : []),
    ...hintProblems(finding.hint),
  ];
  // Code in backticks is the developer's own text (`null!`); only the prose around it is checked.
  const prose = finding.message.replace(/`[^`]*`/g, "code");
  if (/^You(?:r|rs|rself)?\b/.test(prose)) problems.push('headline must not start with "You"');
  if (prose.includes("!")) problems.push('headline must not contain "!"');
  // M15, M16, M19: a fact about the code, with no pointing words and no question; a place not
  // checked says so first, never "stateward cannot tell".
  const pointing = /\b(?:this|here|you)\b/i.exec(prose);
  if (pointing !== null) problems.push(`headline must not point with "${pointing[0]}"`);
  if (prose.includes("?")) problems.push("headline must not be a question");
  if (/\bstateward cannot\b/i.test(prose))
    problems.push('headline must not say "stateward cannot"');
  if (finding.kind === "unknown" && !prose.startsWith("not checked: ")) {
    problems.push('a place not checked must start with "not checked: "');
  }
  if (finding.kind === "problem") {
    finding.related.forEach((related, index) => {
      problems.push(
        ...lineProblems(`related message ${String(index + 1)}`, related.message, undefined),
      );
    });
  }
  return problems;
}

/** Thrown by `expectMessageStandard`; its message lists every violation. */
export class MessageStandardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageStandardError";
  }
}

/** Throws a `MessageStandardError` listing every violation in `findings`; use it in rule tests. */
export function expectMessageStandard(findings: readonly Finding[]): void {
  const violations = findings.flatMap((finding) =>
    messageProblems(finding).map(
      (problem) => `${finding.ruleId} "${finding.message.split("\n")[0] ?? ""}": ${problem}`,
    ),
  );
  if (violations.length > 0) {
    throw new MessageStandardError(
      `${String(violations.length)} message standard violation(s):\n${violations.join("\n")}`,
    );
  }
}
export { typeErrors, typeErrorsOfText, typeErrorsOfTexts } from "./testing-tsc.js";
