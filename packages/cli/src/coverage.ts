import { displayPath } from "@stateward/core/internal";
import type { CheckResult, Config, Finding, Plugin } from "@stateward/core/internal";
import { plural, positionAt } from "./format.js";

/** One place outside a pack's standard: a coverage-rule finding, or code a rule could not decide. */
export type OutsideStandard = {
  ruleId: string;
  kind: "problem" | "unknown";
  /** Relative to the working directory. */
  file: string;
  line: number;
  column: number;
  message: string;
  hint: string;
};

export type PluginCoverage = {
  plugin: string;
  description: string;
  outside: readonly OutsideStandard[];
  /** Findings beyond the per-file cap, counted but not listed. */
  outsideNotListed: number;
  /** Problems of core and add-on rules: only counted here; `stateward check` lists them. */
  problems: number;
  /** Rules of the plugin that are on but cannot report in this project, with why. */
  silent: readonly { ruleId: string; reason: string }[];
};

export type CoverageReport = {
  plugins: readonly PluginCoverage[];
  /** A rule that threw: the report is incomplete. */
  failures: readonly { ruleId: string; message: string }[];
  /** Findings the baseline accepts: not in any count above, which are about what is new. */
  baselined: number;
};

export type CoverageInput = {
  config: Config;
  result: CheckResult;
  cwd: string;
  /** The text of a file, or undefined when it cannot be read (the line is then 1, column 1). */
  readText: (file: string) => string | undefined;
  /** How many findings the baseline accepts (they are already left out of `result`). */
  baselined?: number;
  /** Why rules that are on are silent, by rule id (`Checker.silentReasons`). */
  silent?: ReadonlyMap<string, string>;
};

function ownsRule(plugin: Plugin, ruleId: string): boolean {
  return ruleId.startsWith(`${plugin.name}/`);
}

function isCoverageRule(plugin: Plugin, ruleId: string): boolean {
  const rule = plugin.rules[ruleId.slice(plugin.name.length + 1)];
  return rule?.meta.tier === "coverage";
}

export function buildCoverage({
  config,
  result,
  cwd,
  readText,
  baselined = 0,
  silent = new Map(),
}: CoverageInput): CoverageReport {
  const place = (finding: Exclude<Finding, { kind: "failure" }>): OutsideStandard => {
    const text = readText(finding.location.file);
    const at = text === undefined ? undefined : positionAt(text, finding.location.start);
    return {
      ruleId: finding.ruleId,
      kind: finding.kind,
      file: displayPath(cwd, finding.location.file),
      line: at?.line ?? 1,
      column: at?.column ?? 1,
      message: finding.message,
      hint: finding.hint,
    };
  };

  const plugins = config.plugins.map((plugin): PluginCoverage => {
    const outside: OutsideStandard[] = [];
    let problems = 0;
    for (const finding of result.findings) {
      if (!ownsRule(plugin, finding.ruleId)) continue;
      switch (finding.kind) {
        case "unknown":
          outside.push(place(finding));
          break;
        case "problem":
          if (isCoverageRule(plugin, finding.ruleId)) outside.push(place(finding));
          else problems++;
          break;
        case "failure":
          break;
        default: {
          const unreachable: never = finding;
          return unreachable;
        }
      }
    }
    let outsideNotListed = 0;
    for (const entry of result.hidden) {
      if (!ownsRule(plugin, entry.ruleId)) continue;
      if (isCoverageRule(plugin, entry.ruleId)) outsideNotListed += entry.count;
      else problems += entry.count;
    }
    return {
      plugin: plugin.name,
      description: plugin.description,
      outside,
      outsideNotListed,
      problems,
      silent: [...silent]
        .filter(([ruleId]) => ownsRule(plugin, ruleId))
        .map(([ruleId, reason]) => ({ ruleId, reason })),
    };
  });

  const failures = result.findings.flatMap((finding) =>
    finding.kind === "failure" ? [{ ruleId: finding.ruleId, message: finding.message }] : [],
  );
  return { plugins, failures, baselined };
}

export function formatCoverageJson(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatCoveragePretty(report: CoverageReport): string {
  const lines: string[] = [];
  for (const entry of report.plugins) {
    lines.push(`${entry.plugin}: ${entry.description}`);
    lines.push(
      `${plural(entry.outside.length + entry.outsideNotListed, "place")} it cannot check yet`,
    );
    for (const place of entry.outside) {
      lines.push(
        `  ${place.file}:${String(place.line)}:${String(place.column)}  ${place.message}`,
        `      fix: ${place.hint}`,
      );
    }
    if (entry.outsideNotListed > 0) {
      lines.push(`  … and ${String(entry.outsideNotListed)} more not listed`);
    }
    const listed = entry.problems > 0 ? " (`stateward check` lists them)" : "";
    lines.push(`${plural(entry.problems, "problem")}${listed}`);
    for (const one of entry.silent) lines.push(`${one.ruleId} is on and silent: ${one.reason}`);
    lines.push("");
  }
  if (report.failures.length > 0) {
    lines.push(plural(report.failures.length, "rule failure"));
    for (const failure of report.failures) lines.push(`  ${failure.ruleId}: ${failure.message}`);
    lines.push("");
  }
  if (report.baselined > 0) {
    lines.push(`${plural(report.baselined, "finding")} baselined, not counted above`, "");
  }
  return lines.join("\n");
}
