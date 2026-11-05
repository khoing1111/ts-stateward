import type { RuleCost, RunTiming } from "@stateward/core/internal";

/**
 * `check --timing`: where the check spent its time, for the developers of stateward and of rule
 * packs (docs/user/ci.md, "Why is it slow?"). Printed after the summary.
 */

const ms = (value: number): string => `${Math.round(value).toLocaleString("en-US")} ms`;

const share = (part: number, whole: number): string =>
  whole <= 0 ? "" : `${((100 * part) / whole).toFixed(1)}%`;

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** One phase line: the name padded, the time and the share right-aligned. */
function phaseLine(name: string, value: number, total: number, note = ""): string {
  return `  ${name.padEnd(22)}${ms(value).padStart(11)}${share(value, total).padStart(8)}${note === "" ? "" : `  ${note}`}`;
}

function ruleLine(cost: RuleCost, total: number): string {
  const split =
    cost.kind === "project" ? ` (summarize ${ms(cost.fileMs)}, check ${ms(cost.projectMs)})` : "";
  const reused = cost.reused > 0 ? `, ${String(cost.reused)} from the cache` : "";
  return [
    ms(cost.ms).padStart(11),
    share(cost.ms, total).padStart(7),
    ms(cost.typeMs).padStart(11),
    megabytes(cost.allocatedBytes).padStart(11),
    `  ${cost.ruleId}${split}; ${String(cost.files)} files${reused}`,
  ].join("");
}

/**
 * The timing report: the phases of the check (shares of its whole time), then every rule that ran,
 * the slowest first. `fixTrialsMs`: the time `--format json` spent trying fixes after the check;
 * `peakBytes`: the most memory the process held (its peak resident set).
 */
export function formatTiming(
  run: RunTiming,
  fixTrialsMs: number | undefined,
  peakBytes: number,
): string {
  const total = run.totalMs;
  const ruleMs = run.rules.reduce((sum, cost) => sum + cost.ms, 0);
  const lines = [
    "",
    `Timing (the check took ${ms(total)}; peak memory ${megabytes(peakBytes)}):`,
    phaseLine("building programs", run.programMs, total, "parsing and binding"),
    phaseLine("rules", ruleMs, total),
    phaseLine("  in type questions", run.typeMs, total, "the type checking the rules ask for"),
    phaseLine("fingerprints", run.fingerprintMs, total, "for the results cache"),
    phaseLine("other", run.otherMs, total, "syntax, imports, ignores, sorting"),
    ...(fixTrialsMs === undefined
      ? []
      : [`  ${"trying fixes".padEnd(22)}${ms(fixTrialsMs).padStart(11)}  after the check`]),
    "",
    "Rules by time. share: of the whole check's time. type: of the rule's time, in type questions;",
    "the first rule to ask about a file's types pays for checking them, and the rules after it reuse",
    "that, so turning it off saves less than its line says. allocated: memory the rule allocated",
    "while it ran, summed (most of it freed again), not memory it holds.",
    `${"time".padStart(11)}${"share".padStart(7)}${"type".padStart(11)}${"allocated".padStart(11)}  rule`,
    ...run.rules.map((cost) => ruleLine(cost, total)),
  ];
  return `${lines.join("\n")}\n`;
}
