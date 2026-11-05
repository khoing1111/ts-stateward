import { compareFindings, toTypeScriptPath } from "@stateward/core/internal";
import type { CheckResult, Finding, HiddenFindings } from "@stateward/core/internal";

/** What is known about one file: its findings in order, and the counts of those not listed. */
export type FileFindings = {
  findings: readonly Finding[];
  hidden: readonly HiddenFindings[];
};

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The findings of `file` after a fast pass: the fast pass's file-rule findings only. The project
 * rules' findings of that file are dropped until the next full pass (about a second later): their
 * offsets belong to the text before the edit, so kept they would be drawn in the wrong place.
 */
export function mergeFastPass({
  file,
  fast,
}: {
  file: string;
  fast: Pick<CheckResult, "findings" | "hidden">;
}): FileFindings {
  const key = toTypeScriptPath(file);
  const inFile = (found: { file: string }): boolean => toTypeScriptPath(found.file) === key;
  return {
    findings: fast.findings.filter((finding) => inFile(finding.location)).sort(compareFindings),
    hidden: fast.hidden.filter(inFile).sort((a, b) => compareText(a.ruleId, b.ruleId)),
  };
}
