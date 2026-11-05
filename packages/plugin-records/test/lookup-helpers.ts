import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { Finding, RuleConfig, TextEdit } from "@stateward/core";
import { records } from "../src/index.js";

const RULES = [
  "lookup-misses-key",
  "table-type-too-loose",
  "duplicate-key",
  "keyed-maps-out-of-sync",
] as const;

/** The lookup rules need no add-on; kept so fixtures read the same way. */
export const ADDONS: readonly string[] = [];

export type RuleKey = (typeof RULES)[number];

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** One pack for the whole file, so `checkFixture` answers a repeated question from its cache. */
const pack = records();

/**
 * Runs the pack with every rule but `rule` off, so a fixture is judged by one rule; `setting`
 * gives that rule a severity and options.
 */
export function checkOnly(dir: string, rule: RuleKey, setting?: RuleConfig): readonly Finding[] {
  const settings: Record<string, RuleConfig> = {};
  for (const other of RULES) if (other !== rule) settings[`records/${other}`] = "off";
  if (setting !== undefined) settings[`records/${rule}`] = setting;
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

/**
 * The type errors of each text, checked with the tsc binary, not the checker API. One tsc
 * process compiles them all, each text as a file of its own; a text maps to "" when it compiles.
 * Texts must be modules, or their top-level names would meet in one global scope.
 */
export function typeErrorsOf(texts: readonly string[]): ReadonlyMap<string, string> {
  const unique = [...new Set(texts)];
  const notModules = unique.filter((text) => !/^(?:import|export)\b/m.test(text));
  if (notModules.length > 0) {
    throw new Error("a text with no top-level import or export cannot be compiled with the others");
  }
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-fixed-"));
  try {
    const names = unique.map((_, index) => `a${String(index)}.ts`);
    unique.forEach((text, index) => {
      writeFileSync(path.join(dir, names[index] ?? ""), text);
    });
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          types: [],
        },
        files: names,
      }),
    );
    const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
    const result = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" });
    if (result.status === 0) return new Map(unique.map((text) => [text, ""]));
    // A diagnostic starts at column 0 with its file ("a3.ts(1,2): error ..."); its continuation
    // lines are indented. Output that names no file is shown for every text.
    const perFile = new Map<string, string[]>();
    const unplaced: string[] = [];
    let current: string[] | undefined;
    for (const line of (result.stdout + result.stderr).split(/\r?\n/)) {
      const file = /^(a\d+\.ts)\(/.exec(line)?.[1];
      if (file !== undefined) {
        current = perFile.get(file) ?? [];
        perFile.set(file, current);
      } else if (!/^\s/.test(line)) {
        current = undefined;
      }
      if (current !== undefined) current.push(line);
      else if (line.trim() !== "") unplaced.push(line);
    }
    return new Map(
      unique.map((text, index) => [
        text,
        [...(perFile.get(names[index] ?? "") ?? []), ...unplaced].join("\n"),
      ]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
