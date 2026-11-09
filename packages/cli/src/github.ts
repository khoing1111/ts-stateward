import path from "node:path";
import { hintWithoutExamples, type CheckResult, type Finding } from "@stateward/core/internal";
import { isShownByCheck, positionAt } from "./format.js";

export type GitHubOptions = {
  /** Paths in the annotations are relative to this folder: the repository root. */
  root: string;
  /** The text of a file, or undefined when it cannot be read (the annotation then has no line). */
  readText: (file: string) => string | undefined;
  /** `--verbose`: also annotate the places not checked that are infos, as notices. */
  verbose?: boolean;
};

/** GitHub's rules for the text after `::`: `%`, carriage return and newline are written as %-codes. */
export function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** The same for a property (`file=`, `title=`), which also cannot hold `:` or `,`. */
export function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function level(finding: Finding): "error" | "warning" | "notice" {
  switch (finding.kind) {
    case "failure":
      return "error";
    case "unknown":
      return finding.shown === "warning" ? "warning" : "notice";
    case "problem":
      return finding.severity === "error"
        ? "error"
        : finding.severity === "warning"
          ? "warning"
          : "notice";
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

/** The fix without its code examples, which do not fit in an annotation: its first line and each way to fix (M22). */
function fixLine(hint: string): string {
  return hintWithoutExamples(hint);
}

/**
 * One GitHub Actions workflow command per finding, so each shows on the pull request at its line.
 * Findings that are baselined or ignored are not in `result.findings`, so they are not annotated;
 * the places not checked that are infos are annotated only with `--verbose` (the summary counts them).
 */
export function formatGitHub(result: CheckResult, options: GitHubOptions): string {
  const verbose = options.verbose === true;
  const shown = result.findings.filter((finding) => isShownByCheck(finding, verbose));
  const lines = shown.map((finding) => {
    const { location } = finding;
    const file = path.relative(options.root, location.file).split(path.sep).join("/");
    const text = options.readText(location.file);
    const properties = [`file=${escapeProperty(file)}`];
    if (text !== undefined) {
      const start = positionAt(text, location.start);
      const end = positionAt(text, Math.max(location.start, location.end));
      properties.push(
        `line=${String(start.line)}`,
        `col=${String(start.column)}`,
        `endLine=${String(end.line)}`,
        `endColumn=${String(end.column)}`,
      );
    }
    properties.push(`title=${escapeProperty(finding.ruleId)}`);
    const fix = fixLine(finding.hint);
    const message = fix === "" ? finding.message : `${finding.message} — ${fix}`;
    return `::${level(finding)} ${properties.join(",")}::${escapeData(message)}`;
  });
  return lines.map((line) => `${line}\n`).join("");
}
