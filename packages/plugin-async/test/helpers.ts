import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { check as checkProject, parseConfig } from "@stateward/core";
import type { Finding, RuleConfig, TextEdit } from "@stateward/core";
import { asyncFlow } from "../src/index.js";

export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The findings of the one rule over a fixture project, each already held to the message standard. */
export function check(dir: string, rules: Record<string, RuleConfig> = {}): readonly Finding[] {
  const { findings } = checkFixture(dir, [asyncFlow()], rules);
  expectMessageStandard(findings);
  return findings;
}

/** The parts of a finding a message test compares. */
export type Shown = {
  file: string;
  name: string;
  message: string;
  hint: string;
  notes: string[];
  fix: string | undefined;
};

export function shown(findings: readonly Finding[]): Shown[] {
  return findings.map((finding) => {
    const text = readFileSync(finding.location.file, "utf8");
    return {
      file: path.basename(finding.location.file),
      name: text.slice(finding.location.start, finding.location.end),
      message: finding.message,
      hint: finding.hint,
      notes: finding.kind === "problem" ? finding.related.map((related) => related.message) : [],
      fix: finding.kind === "problem" ? finding.fixes[0]?.title : undefined,
    };
  });
}

export function inFile(findings: readonly Finding[], file: string): readonly Finding[] {
  return findings.filter((finding) => path.basename(finding.location.file) === file);
}

/** Applies edits to a text, last first so earlier offsets stay valid. */
export function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

/** The fixture project with the first quick fix of every finding applied, in a temporary folder; `done` removes it. */
export function withFixesApplied<T>(
  dir: string,
  findings: readonly Finding[],
  use: (fixed: string) => T,
): T {
  const copy = mkdtempSync(path.join(tmpdir(), "stateward-fixed-record-"));
  try {
    cpSync(dir, copy, { recursive: true });
    const files = new Set(findings.map((finding) => finding.location.file));
    for (const file of files) {
      const edits = findings.flatMap((finding) =>
        finding.kind === "problem" && finding.location.file === file
          ? (finding.fixes[0]?.edits ?? [])
          : [],
      );
      const target = path.join(copy, path.basename(file));
      writeFileSync(target, applied(readFileSync(file, "utf8"), edits));
    }
    return use(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** The compiler's complaints about a project: checked with the tsc binary, not the checker API. */
export function typeErrors(dir: string): string {
  const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
  const result = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" });
  return result.status === 0 ? "" : result.stdout + result.stderr;
}

/** The findings of the pack over a fixture project under a named preset. */
export function checkWithPreset(
  dir: string,
  preset: "recommended" | "strict",
  rules: Record<string, RuleConfig> = {},
  addons: readonly string[] = [],
): readonly Finding[] {
  const parsed = parseConfig({ plugins: [asyncFlow()], preset, rules, addons }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return checkProject({ config: parsed.value, cwd: dir }).findings;
}
