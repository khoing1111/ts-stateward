import {
  OUTDATED_BASELINE,
  STRICT_NULLS_REMEDY,
  compareFindings,
  displayPath,
  ignoreFix,
} from "@stateward/core/internal";
import type {
  CheckNotes,
  CheckResult,
  Finding,
  Fix,
  FixReview,
  HiddenFindings,
  Location,
  RelatedLocation,
  TextEdit,
  Severity,
} from "@stateward/core/internal";

export type FormatOptions = {
  cwd: string;
  /** The text of a file, or undefined when it cannot be read (the code frame is then left out). */
  readText: (file: string) => string | undefined;
  color: boolean;
  /** Show at most this many findings, the most severe first; the summary still counts them all. */
  max?: number;
  /** With a baseline: how many findings it accepts (left out of the result) and how many entries are fixed. */
  baseline?: { baselined: number; fixed: number; outdated?: boolean };
  /** With `--changed` or `--staged`: the summary says how many files it covers and what it left out. */
  scope?: SummaryScope;
  /** The config file, relative to `cwd`, when it is not in that folder: the summary names it. */
  configShown?: string;
  /** `--verbose`: also list the places not checked that are infos (by default only counted). */
  verbose?: boolean;
};

/** What `check --changed` / `--staged` left out of the report. */
export type SummaryScope = { files: number; elsewhere: number };

/**
 * Whether a finding is listed: every one but the places not checked that the config's
 * `unknowns: "off"` leaves out (the summary still counts those).
 */
export function isListed(finding: Finding): boolean {
  return finding.kind !== "unknown" || finding.shown !== "off";
}

/**
 * Whether a finding is a rule's place not checked shown as an info: `check` counts these and
 * lists them only with `--verbose` (one count line, never hundreds of infos). As warnings
 * they are something to act on, so they are listed; so are stateward's own (`stateward/syntax`,
 * `stateward/imports`), which say a whole file was not read, and those of a rule that asks for
 * them to be listed (`listUnknowns`: the developer asked for that check, as `@mustHandle`).
 */
export function isQuietUnknown(finding: Finding): boolean {
  return (
    finding.kind === "unknown" &&
    finding.shown === undefined &&
    finding.listed !== true &&
    !finding.ruleId.startsWith("stateward/")
  );
}

/** Whether `check` lists a finding in the terminal or as an annotation. */
export function isShownByCheck(finding: Finding, verbose: boolean): boolean {
  return isListed(finding) && (verbose || !isQuietUnknown(finding));
}

/** Past this many files whose imports do not resolve, `check` lists them only with `--verbose`. */
const IMPORTS_LISTED = 20;

/** How many rules the line about places not checked names; the rest are counted. */
const RULES_NAMED = 3;

/**
 * `655 places not checked (react/dependency-changes-every-render 655); list them with `--verbose` or
 * `stateward coverage``: the line that stands for the places not listed by default, naming the
 * rules with the most. Undefined when there are none, or with `--verbose`.
 */
export function quietUnknownsLine(
  findings: readonly Finding[],
  verbose: boolean,
): string | undefined {
  if (verbose) return undefined;
  const byRule = new Map<string, number>();
  for (const finding of findings) {
    if (isQuietUnknown(finding)) byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
  }
  if (byRule.size === 0) return undefined;
  const total = [...byRule.values()].reduce((sum, count) => sum + count, 0);
  const ranked = [...byRule].sort(
    ([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a > b ? 1 : 0),
  );
  const named = ranked.slice(0, RULES_NAMED).map(([rule, count]) => `${rule} ${String(count)}`);
  const more = ranked.length - RULES_NAMED;
  const rules =
    more > 0 ? `${named.join(", ")} and ${plural(more, "more rule")}` : named.join(", ");
  return `${plural(total, "place")} not checked (${rules}); list them with \`--verbose\` or \`stateward coverage\``;
}

/** Whether a finding counts as a warning: a warning, or a place not checked shown as one. */
export function isWarning(finding: Finding): boolean {
  return finding.kind === "problem"
    ? finding.severity === "warning"
    : finding.kind === "unknown" && finding.shown === "warning";
}

/** Failures first (the check is incomplete), then errors, warnings and the rest. */
function rank(finding: Finding): number {
  switch (finding.kind) {
    case "failure":
      return 0;
    case "unknown":
      return finding.shown === "warning" ? 2 : 3;
    case "problem":
      return finding.severity === "error" ? 1 : finding.severity === "warning" ? 2 : 3;
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

/** The `max` most severe findings, kept in the result's own order (by file, then position). */
function mostSevere(findings: readonly Finding[], max: number): readonly Finding[] {
  const chosen = new Set(
    findings
      .map((finding, index) => ({ finding, index }))
      .sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index)
      .slice(0, max)
      .map((entry) => entry.finding),
  );
  return findings.filter((finding) => chosen.has(finding));
}

type Color = "red" | "yellow" | "cyan" | "blue" | "bold";

const ANSI: Readonly<Record<Color, string>> = {
  red: "\u001b[1;31m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[1;36m",
  blue: "\u001b[1;34m",
  bold: "\u001b[1m",
};
const RESET = "\u001b[0m";

const SEVERITY_COLOR: Readonly<Record<Severity, Color>> = {
  error: "red",
  warning: "yellow",
  info: "cyan",
};

export type Position = { line: number; column: number; lineText: string };

/** 1-based line and column of `offset`, with the text of that line (tabs shown as one space). */
export function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", offset);
  const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  return {
    line: before.split("\n").length,
    column: offset - lineStart + 1,
    lineText: lineText.replace(/\r$/, "").replaceAll("\t", " "),
  };
}

/** What `check --format json` needs to list the fixes: the file texts, and the fixes as tried. */
export type JsonFixes = {
  /**
   * By finding: its fixes after they were tried (`Checker.reviewFixes`), for `--verify-fixes`.
   * Without it the fixes are listed as the rule gave them, `"verified": null` (not tried).
   */
  reviews?: ReadonlyMap<Finding, FixReview> | undefined;
  readText: (file: string) => string | undefined;
};

function jsonEdit(edit: TextEdit): TextEdit {
  const { file, start, end } = edit.location;
  return { location: { file, start, end }, newText: edit.newText };
}

/**
 * A fix with its keys in one fixed order, whether it was just made or read back from the cache
 * (a warm run prints the same bytes as a cold one).
 */
function jsonFix(fix: Fix, verified?: boolean | null): object {
  const { title, edits, safe, changesType, importCleanup, alternatives } = fix;
  return {
    title,
    edits: edits.map(jsonEdit),
    ...(safe === undefined ? {} : { safe }),
    ...(changesType === undefined ? {} : { changesType }),
    ...(importCleanup === undefined ? {} : { importCleanup: importCleanup.map(jsonEdit) }),
    ...(alternatives === undefined
      ? {}
      : { alternatives: alternatives.map((form) => jsonFix(form)) }),
    ...(verified === undefined ? {} : { verified }),
  };
}

/**
 * A finding as the JSON lists it. With `fixes`, a problem's `fixes` are listed with `"verified":
 * null` (not tried); with `fixes.reviews` (`--verify-fixes`) they are the ones that compile
 * (`"verified": true`) and the ones that could not be tried (`"verified": false`), and `rejected`
 * names each form that does not compile and why. `ignore` is the edit of the editor's "Ignore
 * this case here", so a tool reading the JSON can offer what the editor offers.
 */
function jsonFinding(finding: Finding, fixes: JsonFixes | undefined): Finding | object {
  if (fixes === undefined || finding.kind === "failure") return finding;
  const text = fixes.readText(finding.location.file);
  const ignore = text === undefined ? undefined : ignoreFix(finding, text);
  const extra = ignore === undefined ? {} : { ignore: jsonFix(ignore) };
  if (finding.kind === "unknown") return { ...finding, ...extra };
  if (fixes.reviews === undefined) {
    return {
      ...finding,
      fixes: finding.fixes.map((fix) => jsonFix(fix, null)),
      rejected: [],
      ...extra,
    };
  }
  const review = fixes.reviews.get(finding);
  const shown = review?.finding ?? finding;
  return {
    ...shown,
    fixes: [
      ...(shown.kind === "problem" ? shown.fixes : []).map((fix) => jsonFix(fix, true)),
      ...(review?.unchecked ?? []).map((fix) => jsonFix(fix, false)),
    ],
    rejected: review?.rejected ?? [],
    ...extra,
  };
}

/**
 * With a baseline, the accepted findings stay in the list marked `"baselined": true` (a tool
 * reading the JSON decides what to do with them), and `baseline` counts them and the fixed ones.
 * The findings an ignore comment covers stay too, marked `"ignored": { "reason": "…" }`.
 */
export function formatJson(
  result: CheckResult,
  baseline?: { baselined: readonly Finding[]; fixed: number },
  scope?: SummaryScope,
  fixes?: JsonFixes,
): string {
  const ignored = result.ignored ?? [];
  const scoped = scope === undefined ? {} : { changed: scope };
  if (baseline === undefined && ignored.length === 0) {
    return JSON.stringify(
      {
        findings: result.findings.map((finding) => jsonFinding(finding, fixes)),
        hidden: result.hidden,
        ...scoped,
        stats: result.stats,
      },
      null,
      2,
    );
  }
  const entries = [
    ...result.findings.map((finding) => ({ finding, extra: {} })),
    ...(baseline?.baselined ?? []).map((finding) => ({ finding, extra: { baselined: true } })),
    ...ignored.map((entry) => ({
      finding: entry.finding,
      extra: { ignored: { reason: entry.reason } },
    })),
  ]
    .sort((a, b) => compareFindings(a.finding, b.finding))
    .map((entry) => ({ ...jsonFinding(entry.finding, fixes), ...entry.extra }));
  return JSON.stringify(
    {
      findings: entries,
      hidden: result.hidden,
      ...(baseline === undefined
        ? {}
        : { baseline: { baselined: baseline.baselined.length, fixed: baseline.fixed } }),
      ...scoped,
      stats: result.stats,
    },
    null,
    2,
  );
}

export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

type Counts = {
  errors: number;
  warnings: number;
  infos: number;
  unknowns: number;
  /** Places not checked that `unknowns: "off"` leaves out of the list. */
  unlisted: number;
  failures: number;
};

function countFindings(findings: readonly Finding[]): Counts {
  const counts: Counts = {
    errors: 0,
    warnings: 0,
    infos: 0,
    unknowns: 0,
    unlisted: 0,
    failures: 0,
  };
  for (const finding of findings) {
    if (finding.kind === "unknown") {
      counts.unknowns++;
      if (finding.shown === "off") counts.unlisted++;
      continue;
    }
    if (finding.kind === "failure") {
      counts.failures++;
      continue;
    }
    switch (finding.severity) {
      case "error":
        counts.errors++;
        break;
      case "warning":
        counts.warnings++;
        break;
      case "info":
        counts.infos++;
        break;
      default: {
        const unreachable: never = finding.severity;
        return unreachable;
      }
    }
  }
  return counts;
}

export function summaryLine(
  result: CheckResult,
  baselined: number,
  scope?: SummaryScope,
  /** The config file as the reader would type it, when it is not the one in their folder. */
  configShown?: string,
  /** `--verbose`: the quiet places not checked are listed, so the summary counts them. */
  verbose = false,
): string {
  const projects =
    result.stats.projects === undefined
      ? ""
      : ` of ${plural(result.stats.projects.length, "project")}`;
  const files =
    scope === undefined
      ? `${plural(result.stats.files, "file")}${projects}`
      : plural(scope.files, "changed file");
  const config = configShown === undefined ? "" : `; config ${configShown}`;
  const elsewhere =
    scope !== undefined && scope.elsewhere > 0
      ? `${plural(scope.elsewhere, "problem")} elsewhere not shown, `
      : "";
  const seconds = (result.stats.durationMs / 1000).toFixed(1);
  const counts = countFindings(result.findings);
  // The line above the summary already says the quiet places not checked: not said twice.
  if (!verbose) {
    counts.unknowns -= result.findings.filter(isQuietUnknown).length;
  }
  const parts = [
    counts.failures > 0 ? plural(counts.failures, "rule failure") : undefined,
    counts.errors > 0 ? plural(counts.errors, "error") : undefined,
    counts.warnings > 0 ? plural(counts.warnings, "warning") : undefined,
    counts.infos > 0 ? plural(counts.infos, "info") : undefined,
    counts.unknowns > 0
      ? `${plural(counts.unknowns, "place")} not checked${counts.unlisted > 0 ? ` (${String(counts.unlisted)} not listed: \`unknowns: "off"\`)` : ""}`
      : undefined,
  ].filter((part) => part !== undefined);
  const accepted =
    baselined > 0
      ? ` (${String(baselined)} baselined: \`stateward baseline --prune\` after fixing them)`
      : "";
  const covered =
    (result.ignored?.length ?? 0) > 0
      ? `, ${String(result.ignored?.length)} ignored in the code`
      : "";
  if (parts.length === 0)
    return `No problems in ${files} (${elsewhere}${seconds} s${config})${accepted}${covered}.`;
  return `${parts.join(", ")} in ${files} (${elsewhere}${seconds} s${config})${accepted}${covered}. Run \`stateward explain <rule>\` for details.`;
}

function presentation(finding: Finding): {
  color: Color;
  label: string;
  related: readonly RelatedLocation[];
} {
  switch (finding.kind) {
    case "problem":
      return {
        color: SEVERITY_COLOR[finding.severity],
        label: finding.severity,
        related: finding.related,
      };
    case "unknown":
      return finding.shown === "warning"
        ? { color: "yellow", label: "warning", related: [] }
        : { color: "cyan", label: "info", related: [] };
    case "failure":
      return { color: "red", label: "failure", related: [] };
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/**
 * The lines, each said once per run, for what the run could not check as a whole
 * (`CheckResult.notes`): the packs whose rules could not run because a library's types are
 * missing, and the projects without `strictNullChecks`. Empty when there is nothing to say.
 */
export function notesLines(notes: CheckNotes | undefined, cwd: string): readonly string[] {
  if (notes === undefined) return [];
  const missing = notes.missingTypes.map((entry) => {
    const packs = [...new Set(entry.rules.map((ruleId) => ruleId.split("/")[0] ?? ruleId))];
    const which = `${plural(entry.rules.length, "rule")} of the ${andList(packs)} ${packs.length === 1 ? "pack" : "packs"}`;
    return `not checked: ${which}: ${entry.reason}`;
  });
  const loose =
    notes.looseNulls.length === 0
      ? []
      : [
          `\`strictNullChecks\` is off in ${andList(notes.looseNulls.map((file) => `\`${displayPath(cwd, file)}\``))}, so TypeScript does not check \`null\` and \`undefined\` and some fixes prove less: ${STRICT_NULLS_REMEDY}`,
        ];
  return [...missing, ...loose];
}

export function formatPretty(result: CheckResult, options: FormatOptions): string {
  const paint = (color: Color, text: string): string =>
    options.color ? `${ANSI[color]}${text}${RESET}` : text;
  const relative = (file: string): string => displayPath(options.cwd, file);

  const position = (location: Location): Position | undefined => {
    const text = options.readText(location.file);
    return text === undefined ? undefined : positionAt(text, location.start);
  };

  const where = (location: Location): string => {
    const at = position(location);
    return at === undefined
      ? `${relative(location.file)} (offset ${String(location.start)})`
      : `${relative(location.file)}:${String(at.line)}:${String(at.column)}`;
  };

  const whereLine = (location: Location): string => {
    const at = position(location);
    return at === undefined
      ? relative(location.file)
      : `${relative(location.file)}:${String(at.line)}`;
  };

  const frame = (location: Location, color: Color, pad: string): string[] => {
    const at = position(location);
    if (at === undefined) return [];
    const span = Math.max(1, location.end - location.start);
    const width = Math.min(span, Math.max(1, at.lineText.length - at.column + 1));
    const gutter = paint("blue", `${pad} |`);
    return [
      gutter,
      `${paint("blue", `${String(at.line).padStart(pad.length)} |`)} ${at.lineText}`,
      `${gutter} ${" ".repeat(at.column - 1)}${paint(color, "^".repeat(width))}`,
    ];
  };

  const hiddenLines = (file: string): string[] =>
    result.hidden
      .filter((entry: HiddenFindings) => entry.file === file)
      .map(
        (entry) => `  \u2026 and ${String(entry.count)} more ${entry.ruleId} in ${relative(file)}`,
      );

  const lines: string[] = [];
  const verbose = options.verbose === true;
  const unresolved = result.findings.filter((one) => one.ruleId === "stateward/imports").length;
  const banner = unresolved * 5 > result.stats.files;
  // Hundreds of "does not resolve" infos would bury the findings (819 in umami without its
  // packages, user trial 1.0.2): past this many, the line above stands for them.
  const foldImports = banner && !verbose && unresolved > IMPORTS_LISTED;
  if (banner) {
    lines.push(
      `${String(unresolved)} of ${plural(result.stats.files, "file")} import packages that do not resolve: install the project's packages first (\`npm install\`, \`yarn\`, \`pnpm install\`); findings in those files may be missing.${foldImports ? " `--verbose` lists them." : ""}`,
      "",
    );
  }
  const listed = result.findings.filter(
    (finding) =>
      isShownByCheck(finding, verbose) && !(foldImports && finding.ruleId === "stateward/imports"),
  );
  const shown = options.max === undefined ? listed : mostSevere(listed, options.max);
  shown.forEach((finding, index) => {
    const { color, label, related } = presentation(finding);
    const line = position(finding.location)?.line ?? 1;
    const pad = " ".repeat(String(line).length);
    const detail = (name: string, text: string): string =>
      `${pad} ${paint("blue", "=")} ${paint("bold", name)}: ${text}`;
    lines.push(
      `${paint(color, `${label}[${finding.ruleId}]`)}${paint("bold", `: ${finding.message}`)}`,
      `${pad}${paint("blue", "-->")} ${where(finding.location)}`,
      ...frame(finding.location, color, pad),
      detail("fix", finding.hint.split("\n").join(`\n${pad}   `)),
      ...related.map((entry) => {
        // The frame above already shows this line: the note does not repeat where it is.
        const here =
          entry.location.file === finding.location.file && position(entry.location)?.line === line;
        return detail(
          "note",
          here ? entry.message : `${whereLine(entry.location)}: ${entry.message}`,
        );
      }),
      detail("docs", `stateward explain ${finding.ruleId}`),
      "",
    );
    // Hidden counts follow the last shown finding of their file.
    if (shown[index + 1]?.location.file !== finding.location.file) {
      const hidden = hiddenLines(finding.location.file);
      if (hidden.length > 0) lines.push(...hidden, "");
    }
  });

  const notShown = listed.length - shown.length;
  if (notShown > 0) {
    lines.push(
      `\u2026 and ${String(notShown)} more ${notShown === 1 ? "finding" : "findings"} not shown (the most severe come first); run without --max to see them all`,
      "",
    );
  }
  const quiet = quietUnknownsLine(result.findings, verbose);
  if (quiet !== undefined) lines.push(quiet);
  lines.push(...notesLines(result.notes, options.cwd));
  if (options.baseline?.outdated === true) lines.push(OUTDATED_BASELINE, "");
  const fixed = options.baseline?.fixed ?? 0;
  if (fixed > 0) {
    lines.push(
      `${plural(fixed, "baselined finding")} ${fixed === 1 ? "is" : "are"} fixed; run stateward baseline --prune`,
      "",
    );
  }
  lines.push(
    summaryLine(
      result,
      options.baseline?.baselined ?? 0,
      options.scope,
      options.configShown,
      verbose,
    ),
  );
  return `${lines.join("\n")}\n`;
}
