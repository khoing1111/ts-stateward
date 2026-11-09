import { summaryOf, summaryValue } from "./cache.js";
import { renamedRule } from "./renamed.js";
import type { RuleResult } from "./cache.js";
import type { ProjectUnit } from "./backend/typescript6.js";
import type { MarkedComment } from "./backend/comments.js";
import type {
  Finding,
  Fix,
  FixForm,
  IgnoreOptions,
  IgnoredFinding,
  Json,
  Location,
} from "./types.js";

/**
 * Ignore comments: `// stateward-ignore <rule>[, <rule>]:
 * <reason>` covers the findings that start on the next line of code, and
 * `// stateward-ignore-file <rule>: <reason>` the findings of the whole file. The comments are
 * read after the rules have run, from the file's text, so no rule knows about them.
 */

/** The id of the findings about the comments themselves; they cannot be ignored. */
export const IGNORE_RULE_ID = "stateward/ignore";

/** Where a file's comments are kept in its cache entry; no rule key is this short. */
const COMMENTS_KEY = "stateward/ignore-comments";

export type IgnoreRule = { id: string; start: number; end: number };

/** One ignore comment as read from the file, kept as JSON in the cache. */
export type IgnoreDirective = {
  start: number;
  end: number;
  /** A block comment, which a fix writes as a block comment again. */
  block: boolean;
  /** `stateward-ignore-file`. */
  file: boolean;
  /** For the file form: it comes before the first statement, so it counts. */
  placed: boolean;
  rules: IgnoreRule[];
  /** "" when the comment gives none. */
  reason: string;
  /** The line the comment covers, from its first to its last character; -1 when there is none. */
  coverStart: number;
  coverEnd: number;
  /** What removing the comment deletes: its whole line when it has the line to itself. */
  removeStart: number;
  removeEnd: number;
};

// ---- reading the comments ----------------------------------------------------------------------

const DIRECTIVE = /^[\s*]*stateward-ignore(-file)?(?![\w-])/;

/** The line after `from`'s line that holds code, skipping lines of comments; undefined when a blank line or the end comes first. */
function nextCodeLine(text: string, from: number): { start: number; end: number } | undefined {
  let start = text.indexOf("\n", from) + 1;
  if (start === 0) return undefined;
  for (;;) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).trim();
    if (line === "") return undefined;
    if (line.startsWith("//")) {
      if (newline === -1) return undefined;
      start = newline + 1;
      continue;
    }
    if (line.startsWith("/*")) {
      const close = text.indexOf("*/", start + text.slice(start, end).indexOf("/*") + 2);
      if (close === -1) return undefined;
      const after = text.indexOf("\n", close);
      const lineEnd = after === -1 ? text.length : after;
      if (text.slice(close + 2, lineEnd).trim() === "") {
        if (after === -1) return undefined;
        start = after + 1;
        continue;
      }
      return { start, end: lineEnd };
    }
    return { start, end };
  }
}

/** What follows `end` on its line, and what comes before `start` on its line, blank. */
function ownsItsLine(text: string, start: number, end: number): boolean {
  const before = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  return (
    text.slice(before, start).trim() === "" &&
    text.slice(end, newline === -1 ? text.length : newline).trim() === ""
  );
}

function removalRange(text: string, start: number, end: number): { start: number; end: number } {
  if (ownsItsLine(text, start, end)) {
    const newline = text.indexOf("\n", end);
    return {
      start: text.lastIndexOf("\n", start - 1) + 1,
      end: newline === -1 ? text.length : newline + 1,
    };
  }
  // Code shares the line: take the blanks before the comment with it.
  let from = start;
  while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) from--;
  return { start: from, end };
}

/**
 * The line the comment covers, grown to the whole statement that starts on it: a ternary or a call
 * over several lines, a declaration with its body. A comment inside an expression, with no
 * statement starting at the next code, covers its line only.
 */
function wholeStatement(
  line: { start: number; end: number },
  comment: MarkedComment,
  text: string,
): { start: number; end: number } {
  const next = comment.next;
  if (next === undefined || next.start < line.start || next.start > line.end) return line;
  const newline = text.indexOf("\n", next.end);
  const end = Math.max(line.end, newline === -1 ? text.length : newline);
  return { start: line.start, end };
}

/** The directive a comment holds, or undefined when it only mentions the word. */
function readDirective(comment: MarkedComment, text: string): IgnoreDirective | undefined {
  const block = comment.text.startsWith("/*");
  const closed = block && comment.text.endsWith("*/") && comment.text.length >= 4;
  const bodyStart = comment.start + 2;
  const body = comment.text.slice(2, closed ? -2 : undefined);
  const head = DIRECTIVE.exec(body);
  if (head === null) return undefined;
  const rest = body.slice(head[0].length);
  const restStart = bodyStart + head[0].length;
  const colon = rest.indexOf(":");
  const firstLine = rest.search(/\r?\n/);
  const rulesEnd = colon !== -1 ? colon : firstLine === -1 ? rest.length : firstLine;
  const rules: IgnoreRule[] = [];
  for (const match of rest.slice(0, rulesEnd).matchAll(/[^\s,]+/g)) {
    const at = restStart + match.index;
    rules.push({ id: match[0], start: at, end: at + match[0].length });
  }
  const reason =
    colon === -1
      ? ""
      : rest
          .slice(colon + 1)
          .replace(/\s*\r?\n\s*\*?\s*/g, " ")
          .trim();
  const isFile = head[1] !== undefined;
  const sameLine = block ? nextCodeSameLine(text, comment.end) : undefined;
  const lineCover = isFile ? undefined : (sameLine ?? nextCodeLine(text, comment.end));
  const cover = lineCover === undefined ? undefined : wholeStatement(lineCover, comment, text);
  const removal = removalRange(text, comment.start, comment.end);
  return {
    start: comment.start,
    end: comment.end,
    block,
    file: isFile,
    placed: comment.beforeCode,
    rules,
    reason,
    coverStart: cover?.start ?? -1,
    coverEnd: cover?.end ?? -1,
    removeStart: removal.start,
    removeEnd: removal.end,
  };
}

/** A block comment in front of code on its own line covers that line. */
function nextCodeSameLine(text: string, end: number): { start: number; end: number } | undefined {
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline;
  if (text.slice(end, lineEnd).trim() === "" || text.slice(end, lineEnd).trim().startsWith("//")) {
    return undefined;
  }
  return { start: text.lastIndexOf("\n", end - 1) + 1, end: lineEnd };
}

function readDirectives(unit: ProjectUnit, file: string): IgnoreDirective[] {
  const source = unit.ignoreComments(file);
  if (source === undefined) return [];
  return source.comments.flatMap((comment) => {
    const directive = readDirective(comment, source.text);
    return directive === undefined ? [] : [directive];
  });
}

// ---- keeping them in the cache -----------------------------------------------------------------

function isRecord(value: Json | undefined): value is Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function numberOf(value: Json | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseRule(value: Json): IgnoreRule | undefined {
  if (!isRecord(value)) return undefined;
  const { id } = value;
  const start = numberOf(value.start);
  const end = numberOf(value.end);
  return typeof id === "string" && start !== undefined && end !== undefined
    ? { id, start, end }
    : undefined;
}

function parseDirective(value: Json): IgnoreDirective | undefined {
  if (!isRecord(value) || !isList(value.rules)) return undefined;
  const rules = value.rules.map(parseRule);
  const numbers = [
    value.start,
    value.end,
    value.coverStart,
    value.coverEnd,
    value.removeStart,
    value.removeEnd,
  ].map(numberOf);
  const [start, end, coverStart, coverEnd, removeStart, removeEnd] = numbers;
  if (
    start === undefined ||
    end === undefined ||
    coverStart === undefined ||
    coverEnd === undefined ||
    removeStart === undefined ||
    removeEnd === undefined ||
    typeof value.block !== "boolean" ||
    typeof value.file !== "boolean" ||
    typeof value.placed !== "boolean" ||
    typeof value.reason !== "string"
  ) {
    return undefined;
  }
  const known: IgnoreRule[] = [];
  for (const rule of rules) {
    if (rule === undefined) return undefined;
    known.push(rule);
  }
  return {
    start,
    end,
    block: value.block,
    file: value.file,
    placed: value.placed,
    rules: known,
    reason: value.reason,
    coverStart,
    coverEnd,
    removeStart,
    removeEnd,
  };
}

function parseDirectives(value: Json): IgnoreDirective[] | undefined {
  if (!isList(value)) return undefined;
  const found: IgnoreDirective[] = [];
  for (const item of value) {
    const one = parseDirective(item);
    if (one === undefined) return undefined;
    found.push(one);
  }
  return found;
}

/**
 * The ignore comments of one file. They live in the file's entry of the cache (`results`), under
 * the same fingerprint as its findings: the fingerprint covers the file's text, so they are read
 * again exactly when the text changes, and a run answered from the cache never builds a program
 * for them. `stored` is true when this call added them to `results`.
 */
export function fileDirectives(
  unit: ProjectUnit,
  file: string,
  results: Map<string, RuleResult>,
): { directives: readonly IgnoreDirective[]; stored: boolean } {
  const kept = results.get(COMMENTS_KEY)?.summary;
  const parsed = kept === undefined ? undefined : parseDirectives(summaryValue(kept));
  if (parsed !== undefined) return { directives: parsed, stored: false };
  const directives = readDirectives(unit, file);
  results.set(COMMENTS_KEY, { findings: [], summary: summaryOf(directives) });
  return { directives, stored: true };
}

// ---- applying them -----------------------------------------------------------------------------

/** The ids a comment may name, and the ones whose rule ran, for "nothing to ignore" to be a fair judgement. */
export type IgnoreScope = {
  /** Every rule id of the config's plugins, and the ids stateward reports itself. */
  known: ReadonlySet<string>;
  /** The ids that ran in this pass. */
  ran: ReadonlySet<string>;
  /** The config's `ignores`: whether a reason is required and how an unneeded comment is reported. */
  options: IgnoreOptions;
};

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(
        Math.min((previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
      );
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/** The known id closest to a mistyped one: the id it is the end of, else the nearest spelling. */
function closest(id: string, known: ReadonlySet<string>): string | undefined {
  const choices = [...known].filter((one) => one !== IGNORE_RULE_ID).sort();
  const ending = choices.filter((one) => one.endsWith(`/${id}`));
  if (ending.length === 1) return ending[0];
  let best: { id: string; far: number } | undefined;
  for (const one of choices) {
    const far = distance(id, one);
    if (best === undefined || far < best.far) best = { id: one, far };
  }
  return best !== undefined && best.far <= Math.max(2, Math.floor(id.length / 3))
    ? best.id
    : undefined;
}

const MAX_HEADLINE = 100;
const MAX_HINT = 140;

/** `text` when it fits `max`, else `shorter`. */
function fits(text: string, max: number, shorter: string): string {
  return text.length <= max ? text : shorter;
}

function names(ids: readonly string[]): string {
  return ids.map((id) => `\`${id}\``).join(", ");
}

function commentFinding(
  file: string,
  at: { start: number; end: number },
  severity: "error" | "warning",
  message: string,
  hint: string,
  fixes: readonly Fix[],
): Finding {
  const location: Location = { file, start: at.start, end: at.end };
  return {
    kind: "problem",
    ruleId: IGNORE_RULE_ID,
    severity,
    message,
    hint,
    location,
    related: [],
    fixes,
  };
}

function rebuilt(directive: IgnoreDirective, keep: readonly string[]): string {
  const reason = directive.reason === "" ? "" : `: ${directive.reason}`;
  const body = `stateward-ignore${directive.file ? "-file" : ""} ${keep.join(", ")}${reason}`;
  return directive.block ? `/* ${body} */` : `// ${body}`;
}

/** The findings about one comment: no rule named, in the wrong place, unknown id, no reason, not needed. */
function judge(
  file: string,
  directive: IgnoreDirective,
  used: ReadonlySet<string>,
  scope: IgnoreScope,
): Finding[] {
  const here = { start: directive.start, end: directive.end };
  const form = directive.file ? "stateward-ignore-file" : "stateward-ignore";
  if (directive.rules.length === 0) {
    return [
      commentFinding(
        file,
        here,
        "warning",
        "ignore comment does not name a rule",
        `write the rule, then why: \`// ${form} <rule>: <why this case is fine>\``,
        [],
      ),
    ];
  }
  if (directive.file && !directive.placed) {
    return [
      commentFinding(
        file,
        here,
        "warning",
        "`stateward-ignore-file` must come before the first statement",
        "move it to the top of the file, above the imports; until then it ignores nothing",
        [],
      ),
    ];
  }
  const found: Finding[] = [];
  const unused: string[] = [];
  for (const rule of directive.rules) {
    if (rule.id === IGNORE_RULE_ID) {
      found.push(
        commentFinding(
          file,
          rule,
          "error",
          "`stateward/ignore` findings cannot be ignored",
          "fix the comment the finding points at, or remove it",
          [],
        ),
      );
    } else if (!scope.known.has(rule.id) && renamedRule(rule.id) !== undefined) {
      // A renamed rule: the comment still works under the old id.
      const now = renamedRule(rule.id) ?? rule.id;
      // One cause, one message: an ignore that is not needed is removed, not renamed; two fixes on
      // one comment would also clash in `--fix`.
      if (!used.has(now) && scope.ran.has(now)) {
        unused.push(rule.id);
        if (scope.options.reportUnused !== "off") continue;
      }
      found.push(
        commentFinding(
          file,
          rule,
          "warning",
          fits(
            `\`${rule.id}\` is now \`${now}\`; rename it in this ignore`,
            MAX_HEADLINE,
            "ignore comment names a rule by its old id",
          ),
          fits(
            `change it to \`${now}\` (quick fix); the old id still works`,
            MAX_HINT,
            "change it to the new id (quick fix); the old id still works",
          ),
          [
            {
              title: `Change to \`${now}\``,
              safe: true,
              edits: [{ location: { file, start: rule.start, end: rule.end }, newText: now }],
            },
          ],
        ),
      );
    } else if (!scope.known.has(rule.id)) {
      const guess = closest(rule.id, scope.known);
      found.push(
        commentFinding(
          file,
          rule,
          "error",
          fits(
            `\`${rule.id}\` is not a stateward rule`,
            MAX_HEADLINE,
            "ignore comment names a rule that does not exist",
          ),
          fits(
            guess === undefined
              ? "write a rule id as a finding shows it, such as `records/lookup-misses-key`; until then the comment ignores nothing"
              : `write \`${guess}\`, the rule with the nearest name; until then the comment ignores nothing`,
            MAX_HINT,
            "check the rule id; until it is right the comment ignores nothing",
          ),
          guess === undefined
            ? []
            : [
                {
                  title: `Change to \`${guess}\``,
                  edits: [{ location: { file, start: rule.start, end: rule.end }, newText: guess }],
                },
              ],
        ),
      );
    } else if (!used.has(rule.id) && scope.ran.has(rule.id)) {
      unused.push(rule.id);
    }
  }
  if (unused.length > 0 && scope.options.reportUnused !== "off") {
    const everything = unused.length === directive.rules.length;
    const keep = directive.rules.map((rule) => rule.id).filter((id) => !unused.includes(id));
    const where = directive.file ? "in the file" : "in the code it covers";
    found.push(
      commentFinding(
        file,
        here,
        scope.options.reportUnused,
        fits(
          `ignore comment is not needed: ${names(unused)} finds nothing ${where}`,
          MAX_HEADLINE,
          `ignore comment is not needed: ${String(unused.length)} of its rules find nothing ${where}`,
        ),
        "remove it (quick fix); the code it covered is fixed, or has moved",
        [
          everything
            ? {
                title: "Remove the ignore comment",
                safe: true,
                edits: [
                  {
                    location: { file, start: directive.removeStart, end: directive.removeEnd },
                    newText: "",
                  },
                ],
              }
            : {
                title: `Remove ${names(unused)} from the ignore comment`,
                safe: true,
                edits: [{ location: { file, ...here }, newText: rebuilt(directive, keep) }],
              },
        ],
      ),
    );
  }
  if (directive.reason === "" && scope.options.requireReason) {
    const first = directive.rules[0]?.id ?? "<rule>";
    found.push(
      commentFinding(
        file,
        here,
        "warning",
        "ignore comment does not say why the case is fine",
        fits(
          `add the reason after a colon: \`// ${form} ${first}: <why this case is fine>\``,
          MAX_HINT,
          "add the reason after a colon, and say why this case is fine",
        ),
        [],
      ),
    );
  }
  return found;
}

/**
 * Takes the findings that ignore comments cover out of `findings` and adds the findings about
 * the comments (`stateward/ignore`). Failures are never covered: the check was incomplete. The
 * result is not sorted; the caller sorts it with the rest.
 */
export function applyIgnores(
  findings: readonly Finding[],
  directives: ReadonlyMap<string, readonly IgnoreDirective[]>,
  scope: IgnoreScope,
): { findings: Finding[]; ignored: IgnoredFinding[] } {
  if (directives.size === 0) return { findings: [...findings], ignored: [] };
  const kept: Finding[] = [];
  const ignored: IgnoredFinding[] = [];
  const used = new Map<IgnoreDirective, Set<string>>();
  for (const finding of findings) {
    const { file, start } = finding.location;
    const reason =
      finding.kind === "failure"
        ? undefined
        : coveredBy(directives.get(file) ?? [], finding.ruleId, start, used);
    if (reason === undefined) kept.push(finding);
    else ignored.push({ finding, reason });
  }
  for (const [file, list] of directives) {
    for (const directive of list) {
      kept.push(...judge(file, directive, used.get(directive) ?? new Set(), scope));
    }
  }
  return { findings: kept, ignored };
}

/** The reason of the first comment that covers the finding (every one that does counts as used). */
function coveredBy(
  list: readonly IgnoreDirective[],
  ruleId: string,
  start: number,
  used: Map<IgnoreDirective, Set<string>>,
): string | undefined {
  let reason: string | undefined;
  for (const directive of list) {
    if (directive.file && !directive.placed) continue;
    if (!directive.rules.some((rule) => (renamedRule(rule.id) ?? rule.id) === ruleId)) continue;
    const covers = directive.file || (directive.coverStart <= start && start <= directive.coverEnd);
    if (!covers) continue;
    const ids = used.get(directive) ?? new Set<string>();
    ids.add(ruleId);
    used.set(directive, ids);
    reason ??= directive.reason;
  }
  return reason;
}

/** The page `stateward explain stateward/ignore` shows. */
export const IGNORE_EXPLAIN = `# stateward/ignore

A \`stateward-ignore\` comment is missing its reason, names a rule that does not exist, or ignores nothing.

## Why

A comment that ignores one case should say why the case is fine, and should go when the case is fixed.
Otherwise the next person cannot tell an intended exception from a forgotten one, and old comments
pile up. stateward checks the comments the way it checks your code.

## When to use it

Put a comment on the line above a finding that is intended, with the rule and the reason:

    // stateward-ignore records/lookup-misses-key: keys come from the server's fixed list
    const label = labels[status];

Several rules go in one comment, separated by commas. For a whole file, put
\`// stateward-ignore-file <rule>: <reason>\` above its first statement. Comment lines between the
ignore and the code are fine. In VS Code, the quick fix "Add an ignore comment" writes it.

## What it catches

- an ignore with no reason after the colon (it still works; this is a warning)
- an ignore that no longer covers a finding: the code was fixed or moved (a warning; the quick fix removes it)
- a rule id that does not exist, with the closest one (an error: the ignore does nothing)
- \`stateward-ignore-file\` below the first statement, and an ignore with no rule

## What it does not catch

Whether the reason is a good one. A comment is not the same as a baseline: the baseline says "fix
later", a comment says "this is intended". Both stay. Findings of this rule cannot be ignored.

## Turn it on or off

It is always on. \`stateward check --no-ignores\` shows the findings that comments cover, and the
summary counts them ("2 ignored in the code"). Fix a comment, or remove it, to clear its finding.
`;

export const IGNORE_FIX_TITLE = "Add an ignore comment";

/**
 * "Ignore this case here": `// stateward-ignore <rule>: ` on the line above the finding, indented
 * like it, so the warning about the missing reason asks for the reason at once. Undefined for a
 * finding no comment can cover: a failure, or a finding about a comment. The editor offers it after
 * the fixes and `check --format json` lists it as `ignore`; it is a decision for a person, so
 * neither "fix all" nor `check --fix` applies it.
 */
export function ignoreFix(finding: Finding, text: string): FixForm | undefined {
  if (finding.kind === "failure" || finding.ruleId === IGNORE_RULE_ID) return undefined;
  const { file, start } = finding.location;
  const lineStart = text.lastIndexOf("\n", Math.min(start, text.length) - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
  return {
    title: IGNORE_FIX_TITLE,
    edits: [
      {
        location: { file, start: lineStart, end: lineStart },
        newText: `${indent}// stateward-ignore ${finding.ruleId}: \n`,
      },
    ],
  };
}
