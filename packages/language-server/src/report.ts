import { displayPath } from "@stateward/core/internal";
import type { CheckResult, Finding, LongestStep } from "@stateward/core/internal";

export type Counts = { errors: number; warnings: number; infos: number };

/** How a finding is counted: a problem by its own severity, an unknown with the infos (shown as a faint hint) or the warnings (as `unknowns` says), a failure as a warning. */
function bucket(finding: Finding): keyof Counts {
  switch (finding.kind) {
    case "problem":
      switch (finding.severity) {
        case "error":
          return "errors";
        case "warning":
          return "warnings";
        case "info":
          return "infos";
        default: {
          const unreachable: never = finding.severity;
          return unreachable;
        }
      }
    case "unknown":
      return finding.shown === "warning" ? "warnings" : "infos";
    case "failure":
      return "warnings";
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

/** How many findings of each editor severity a result has. */
export function countFindings(result: CheckResult): Counts {
  const counts: Counts = { errors: 0, warnings: 0, infos: 0 };
  for (const finding of result.findings) counts[bucket(finding)] += 1;
  return counts;
}

/** `checked 3002 files in 1.4 s: 0 errors, 1 warnings, 2 infos`: the line logged after a full pass. */
export function fullPassLine(result: CheckResult): string {
  const counts = countFindings(result);
  const seconds = (result.stats.durationMs / 1000).toFixed(1);
  return `checked ${String(result.stats.files)} files in ${seconds} s: ${String(counts.errors)} errors, ${String(counts.warnings)} warnings, ${String(counts.infos)} infos`;
}

/** `checked src/App.tsx in 38 ms`: the line logged after a fast pass. */
export function fastPassLine(files: readonly string[], result: CheckResult): string {
  return `checked ${files.join(", ")} in ${String(result.stats.durationMs)} ms`;
}

/** A step this long is logged: an edit made during it waited that long for its findings. */
export const LONG_STEP_MS = 300;

/**
 * `longest step 2900 ms: errors/result-unchecked on src/a.tsx`: logged after a project check
 * whose longest step kept edits waiting at least `LONG_STEP_MS`; undefined
 * otherwise. Paths are relative to `cwd`, with `/`.
 */
export function longestStepLine(longest: LongestStep, cwd: string): string | undefined {
  if (longest.ms < LONG_STEP_MS) return undefined;
  const ms = String(Math.round(longest.ms));
  const at = longest.at;
  if (at === undefined) return `longest step ${ms} ms: finishing the project check`;
  if (at.phase === "files" && at.done === 0 && at.rule === undefined) {
    return `longest step ${ms} ms: building the programs`;
  }
  const file = at.file === undefined ? undefined : displayPath(cwd, at.file);
  if (at.rule !== undefined && file !== undefined) {
    return `longest step ${ms} ms: ${at.rule} on ${file}`;
  }
  if (at.rule !== undefined) return `longest step ${ms} ms: ${at.rule} over the whole project`;
  return `longest step ${ms} ms: ${at.phase === "files" ? "checking files" : "project rules"}`;
}
