import ts from "@stateward/core/typescript";
import {
  defineRule,
  option,
  type FileContext,
  type Fix,
  type Literal,
  type TextEdit,
} from "@stateward/core";
import {
  afterLine,
  checkCode,
  checkForms,
  checkStatements,
  enumSpellings,
  ignoredType,
  indentUnit,
  insertProof,
  isJump,
  isPlainReference,
  jumpToCopy,
  leadingSpace,
  listTitle,
  neverHelper,
  proofTarget,
  provesCompleteness,
  restExample,
  restType,
  satisfiesStatement,
  stripParentheses,
  unresolvedCheck,
  valueCode,
  type Check,
  type NeverHelper,
  withAlternatives,
} from "./proof.js";
import { HEADLINE_MAX, compactText, fitted, fittedCases, oneLineText, shorten } from "./text.js";

const EXPLAIN = `# unions/default-hides-cases

A switch over a union handles every case, so a value added later fails to compile instead of falling into the default.

## Why

A \`default\` takes every case the switch does not list, including ones added later. When \`UploadStatus\` gains \`"cancelled"\`, the code still compiles, and \`"cancelled"\` does whatever the \`default\` does (say, shows a spinner forever) because nobody decided what it should do. With the missing cases written out and \`status satisfies never\` in the \`default\`, adding \`"cancelled"\` becomes a type error at this switch.

## When to use it

Use it wherever you switch over a union of known values: a status, an action \`type\`, an enum. It is on as an error in every preset. Turn it off, or make it a warning, while your code still uses plain \`string\` where it means a fixed set of values; a switch over a \`string\` is never checked anyway.

## What it catches

A \`default\` in a switch over a union of literals (strings, numbers, booleans, enum members, \`null\`, \`undefined\`) declared in your project, unless the \`default\` starts with a check TypeScript enforces: \`status satisfies never;\` (also written \`(status) satisfies never;\` or \`void (status satisfies never);\`), \`status satisfies Rest;\` where \`Rest\` names exactly the cases that fall through (below), assigning \`status\` to a \`never\` variable, or passing it to a function whose parameter is \`never\`, such as your own \`ensureNever\`.

For \`switch (node.type)\` over a union of objects, TypeScript narrows \`node\` itself, so the check is \`node satisfies never\`: \`node.type\` no longer compiles there.

A \`default\` that hides more than 5 cases (option \`maxHidden\`) is reported as info: it often means "everything else" on purpose.

### Bad

\`\`\`ts
switch (status.kind) {
  case "idle":
    return start();
  default:
    return wait(); // also runs for "retry" and "cancel"
}
\`\`\`

### Good

\`\`\`ts
switch (status.kind) {
  case "idle":
    return start();
  case "retry":
    return again();
  case "cancel":
    return stop();
  default:
    status satisfies never;
    return wait();
}
\`\`\`

If the hidden cases really all mean the same (a router that handles 3 of 88 events), keep the \`default\` and say which cases they are, in a form TypeScript checks:

\`\`\`ts
type OtherEvent = "scroll" | "resize";

switch (event.type) {
  case "click":
    return open();
  case "key":
    return type();
  default:
    event.type satisfies OtherEvent; // these, and only these, fall through on purpose
    return log(event);
}
\`\`\`

The type names exactly the cases the \`default\` takes, written out as a union (\`"scroll" | "resize"\`) or an alias of one; \`void (event.type satisfies OtherEvent)\` and \`(event.type) satisfies OtherEvent\` count too. A case added later fails to compile there, so you decide where it goes. It is checked like \`satisfies never\`: the rule is silent. \`Exclude<Event["type"], "click" | "key">\` is accepted too, as your stated choice, but it grows with the union: a case added later falls into the \`default\` again without a word. Write the cases out unless that is what you want. A type that names more cases than the \`default\` takes (one the switch already lists) or fewer says something else, so the finding stays, with the exact type in its hint (TypeScript itself rejects the narrower one). Or say why on the line above it: \`// stateward-ignore unions/default-hides-cases: every other event is logged only\`.

### Fix

When every case is already written and only the check is missing, a quick fix adds \`status satisfies never;\` at the top of the \`default\`, which keeps the fallback running; \`stateward check --fix\` applies it too. The quick fix also handles:

- a case that shares the default's body (\`case "neutral": default:\`): the case gets its own copy of the body, and the \`default\` the check, then the body;
- a value named \`type\` (or \`module\`, \`namespace\`, …), which would start a declaration: it writes \`void (type satisfies never);\`;
- a switch inside \`useMemo\`, \`useCallback\`, \`useEffect\` or \`useLayoutEffect\` whose code reads only \`selectedNode.type\`: it switches on \`const nodeType = selectedNode.type;\` and checks \`nodeType\`, so the hook's dependencies stay \`selectedNode.type\`.

When the \`default\` hides cases, the quick fix "List the 2 hidden cases (same behaviour)" writes them as \`case\` labels that run the old \`default\` body, then adds a new \`default\` with the check. If your project has its own \`never\` helper (a function the file declares or imports that takes \`never\`), the new \`default\` calls it:

\`\`\`ts
case "retry":
case "cancel":
  return wait();
default:
  return ensureNever(status); // or: status satisfies never; return wait();
\`\`\`

Every case still does what it did, and a value added later fails to compile. Then give each case its own code where it needs it. \`--fix\` does not apply it: a value outside the type at run time (from an \`as\` cast or unchecked data) now skips the old body. It is offered when the hidden cases can be written as values (strings, numbers, booleans, enum members, \`null\`, \`undefined\`), and not when the \`default\` falls into the next \`case\`.

The second quick fix, "Add \`event.type satisfies "scroll" | "resize";\` to the default", keeps the \`default\` and its body and writes the check above, with the cases that fall through today, as its first statement. It changes nothing at run time, but saying "these cases all mean the same" is your decision, so \`--fix\` and "Fix all" never apply it.

Each quick fix is tried on a copy of your code first, in its forms in order (the \`const\` of the tag, the object, the value itself; your helper, then \`satisfies never\`), and offered only in the first form that compiles.

A computed subject (\`draft.alertMode ?? "none"\`, \`getMode()\`) is not narrowed by TypeScript, so no check on it compiles and there is no quick fix: put it in a \`const\` first (\`const alertMode = draft.alertMode ?? "none"; switch (alertMode)\`).

## What it does not catch

- A switch over a type with no fixed set of values (\`string\`, \`number\`, an object).
- A union declared in a package or in TypeScript's lib (\`Intl.LDMLPluralRule\`, a library's event type): a member the library adds later is not a state your app designed. Set \`projectTypesOnly: false\` to check those too.
- A \`default\` that hands the value to a function whose type does not resolve (\`exhaustiveSwitchError(info)\` from a package whose types are not built): it may be a \`never\` check, so the finding is an unknown that says so.
- A switch without a \`default\`. For missing cases there, use typescript-eslint's \`switch-exhaustiveness-check\`.
- \`switch (true)\` and \`switch (typeof x)\`.
- A switch over \`o?.kind\` when \`o\` can be \`undefined\` and is not itself a union with a \`kind\`: TypeScript keeps \`undefined\` in every case, so \`satisfies never\` cannot compile there.
- A check that does not always run counts as missing: one inside an \`if\`, a loop, a \`try\`, a function, or after \`&&\`, \`||\`, \`??\` or \`?:\`. Put it directly in the \`default\`.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "unions/default-hides-cases": "off" } // or "warning"
rules: { "unions/default-hides-cases": ["error", { maxHidden: 10 }] } // info only above 10 hidden cases
rules: { "unions/default-hides-cases": ["error", { projectTypesOnly: false }] } // packages' unions too
rules: { "unions/default-hides-cases": ["error", { ignore: ["*Event"] }] } // unions not checked
rules: { "unions/default-hides-cases": ["error", { severities: { "many-hidden": "warning" } }] } // per kind of finding
groups: { "guards/switches": "off" } // the whole group
\`\`\`
`;

/**
 * The labels the case clauses cover, or undefined when a case is not one literal (`case other:` with
 * `other: string`): then the switch cannot be judged.
 */
function coveredLabels(
  clauses: readonly ts.CaseOrDefaultClause[],
  ctx: FileContext,
): Set<string> | undefined {
  const covered = new Set<string>();
  for (const clause of clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const literals = ctx.types.literalsOf(clause.expression);
    // A case whose type is several literals (`case mode:`) matches only one of them at run time.
    const [only] = literals === "not-finite" ? [] : literals;
    if (only === undefined || literals.length !== 1) return undefined;
    covered.add(only.label);
  }
  return covered;
}

/**
 * The `case` clauses with no statements right before the `default`, which share its body
 * (`case "neutral": default:`): in the `default` the subject can still be one of them, so a check
 * there does not compile until each has its own copy of the body.
 */
function sharingCases(
  clause: ts.DefaultClause,
  clauses: readonly ts.CaseOrDefaultClause[],
): ts.CaseClause[] {
  const sharing: ts.CaseClause[] = [];
  for (let index = clauses.indexOf(clause) - 1; index >= 0; index -= 1) {
    const before = clauses[index];
    if (before === undefined || !ts.isCaseClause(before) || before.statements.length > 0) break;
    sharing.unshift(before);
  }
  return sharing;
}

/** Whether a branch declares a name at its top (`const x`), which a copy would declare twice. */
function declaresAtTop(statements: readonly ts.Statement[]): boolean {
  return statements.some(
    (statement) =>
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement),
  );
}

function startsLine(text: string, position: number): boolean {
  return /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", position - 1) + 1, position));
}

/** The indentation of a branch's statements: theirs, or one level in from `clause`. */
function bodyIndentOf(clause: ts.CaseOrDefaultClause, ctx: FileContext): string {
  const text = ctx.sourceFile.text;
  const firstStart = clause.statements[0]?.getStart(ctx.sourceFile);
  if (firstStart !== undefined && startsLine(text, firstStart))
    return leadingSpace(text, firstStart);
  const indent = leadingSpace(text, clause.getStart(ctx.sourceFile));
  return indent + indentUnit(indent);
}

/**
 * Gives the cases that share the default's body their own copy of it (with a `break` when the
 * body ran to the end of the switch), so no listed case reaches the `default`. Undefined when a
 * copy would not do the same: the body falls into the next case or declares a name.
 */
function splitShared(
  clause: ts.DefaultClause,
  clauses: readonly ts.CaseOrDefaultClause[],
  ctx: FileContext,
): TextEdit | undefined {
  const statements = clause.statements;
  const first = statements[0];
  const last = statements[statements.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const jumps = isJump(last);
  if (clauses[clauses.length - 1] !== clause && !jumps) return undefined;
  const text = ctx.sourceFile.text;
  const start = clause.getStart(ctx.sourceFile);
  if (!startsLine(text, start)) return undefined;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const bodyIndent = bodyIndentOf(clause, ctx);
  const body = text.slice(first.getStart(ctx.sourceFile), last.end);
  const ending = jumps ? "" : `${eol}${bodyIndent}break;`;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const at = { file: ctx.file, start: lineStart, end: lineStart };
  if (!declaresAtTop(statements)) {
    return { location: at, newText: `${bodyIndent}${body}${ending}${eol}` };
  }
  // The cases of a switch share one scope: a copy of `const x` goes in a block of its own. Its
  // lines move one level in, which would change a template literal that spans lines.
  if (spansLinesInTemplate(statements)) return undefined;
  const unit = indentUnit(bodyIndent);
  const inner = body
    .split(/\r?\n/)
    .map((line, index) =>
      index === 0 ? `${bodyIndent}${unit}${line}` : line === "" ? "" : `${unit}${line}`,
    )
    .join(eol);
  return {
    location: at,
    newText: `${bodyIndent}{${eol}${inner}${eol}${bodyIndent}}${ending}${eol}`,
  };
}

/** Whether a template literal in the statements spans lines: re-indenting would change its text. */
function spansLinesInTemplate(statements: readonly ts.Statement[]): boolean {
  const found = (node: ts.Node): boolean =>
    ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.getText().includes("\n")) ||
    ts.forEachChild(node, found) === true;
  return statements.some(found);
}

/**
 * The copy a sharing case gets, on one line for the hint: the default's first statement, in a
 * block when the body declares a name, and `break;` when the body ran to the end of the switch.
 */
function sharedCopy(
  clause: ts.DefaultClause,
  clauses: readonly ts.CaseOrDefaultClause[],
  ctx: FileContext,
): string | undefined {
  const statements = clause.statements;
  const [first] = statements;
  const last = statements[statements.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const shown = oneLineText(first, ctx.sourceFile);
  const more = statements.length > 1 ? " …" : "";
  const copy = declaresAtTop(statements) ? `{ ${shown}${more} }` : `${shown}${more}`;
  return isJump(last) || clauses[clauses.length - 1] !== clause ? copy : `${copy} break;`;
}

function proofFix(
  clause: ts.DefaultClause,
  clauses: readonly ts.CaseOrDefaultClause[],
  check: Check,
  ctx: FileContext,
  rest?: { subject: string; type: string },
): Fix | undefined {
  const first = clause.statements[0];
  // A default with no statements falls through, so adding one would change what it does: no fix.
  if (first === undefined) return undefined;
  let before: TextEdit[] = [];
  if (sharingCases(clause, clauses).length > 0) {
    const split = splitShared(clause, clauses, ctx);
    if (split === undefined) return undefined;
    before = [split];
  }
  const opener = clause
    .getChildren(ctx.sourceFile)
    .find((c) => c.kind === ts.SyntaxKind.ColonToken);
  return insertProof({ first, opener, outer: clause, check, place: "default", before, rest, ctx });
}

/**
 * Replaces `default:` with a `case` for each hidden member, which falls into the old body, and
 * adds a new `default:` that checks nothing is left. Every value of the type takes the same path
 * as before; only a value outside the type (from `as` or bad data) now skips the old body, so the
 * fix is not safe for `--fix`.
 */
function listFix(input: {
  clause: ts.DefaultClause;
  clauses: readonly ts.CaseOrDefaultClause[];
  hidden: readonly Literal[];
  check: Check;
  helper: NeverHelper | undefined;
  ctx: FileContext;
}): Fix | undefined {
  const { clause, clauses, hidden, check, helper, ctx } = input;
  const spellings = enumSpellings(
    clauses.filter(ts.isCaseClause).map((c) => c.expression),
    ctx,
  );
  const values: string[] = [];
  for (const literal of hidden) {
    const code = valueCode(literal.label, spellings);
    if (code === undefined) return undefined;
    values.push(code);
  }
  const colon = clause.getChildren(ctx.sourceFile).find((c) => c.kind === ts.SyntaxKind.ColonToken);
  if (colon === undefined) return undefined;
  const text = ctx.sourceFile.text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const start = clause.getStart(ctx.sourceFile);
  const indent = leadingSpace(text, start);
  const bodyIndent = bodyIndentOf(clause, ctx);
  const first = clause.statements[0];
  const isLast = clauses[clauses.length - 1] === clause;
  const last = clause.statements[clause.statements.length - 1];
  // A default in the middle that falls into the next case would fall into the new default too,
  // where TypeScript then sees the listed cases, not `never`.
  if (!isLast && (last === undefined || !isJump(last))) return undefined;
  const cases = values.map((value) => `case ${value}:`).join(`${eol}${indent}`);
  // The new default ends as the old body did, so a function that returned there still does.
  const jump = jumpToCopy(clause.statements);
  if (jump === undefined) return undefined;
  // The old body was last and ran to the end of the switch: a `break` keeps it from falling into
  // the new default, which `noFallthroughCasesInSwitch` would reject, and which would no longer
  // see the subject as `never` when it shared the body with the listed cases.
  const needsBreak = isLast && (last === undefined || !isJump(last));
  const body = checkStatements({
    target: check.target,
    helper,
    jump,
    inSwitch: true,
    sourceFile: ctx.sourceFile,
  })
    .map((line) => `${eol}${bodyIndent}${line}`)
    .join("");
  const proof = `${needsBreak ? `${eol}${bodyIndent}break;` : ""}${eol}${indent}default:${body}`;
  const file = ctx.file;
  // An empty default ends at its colon: one edit, so the two never touch.
  const at = afterLine(text, clause.end);
  const edits: TextEdit[] =
    first === undefined
      ? [{ location: { file, start, end: colon.end }, newText: `${cases}${proof}` }]
      : [
          { location: { file, start, end: colon.end }, newText: cases },
          { location: { file, start: at, end: at }, newText: proof },
        ];
  return { title: listTitle(values.length), edits: [...check.setup, ...edits] };
}

function isUndefined(literal: Literal): boolean {
  return literal.value === undefined;
}

function hiddenHeadline(hidden: readonly Literal[], subject: string, maxHidden: number): string {
  const noun = hidden.length === 1 ? "case" : "cases";
  return fittedCases(
    HEADLINE_MAX,
    hidden.map((literal) => literal.label),
    maxHidden,
    (cut, labels) =>
      `this \`default\` hides ${String(hidden.length)} ${noun} of \`${cut(subject)}\`${labels}`,
  );
}

/** The longest label or statement an example line shows before it is cut. */
const EXAMPLE_TEXT_MAX = 60;

/** The hint's example: indented 4 spaces, one line per entry. */
function example(lines: readonly string[]): string {
  return lines.map((line) => `    ${line}`).join("\n");
}

const RULE_NAME = "default-hides-cases";

/**
 * The two ways out of a `default` that hides cases: list them, or say in an ignore comment why the
 * `default` is right for all of them. Above `maxHidden` cases the second comes first: a `default`
 * for many cases is often "everything else" on purpose (a router of 88 events).
 */
function hiddenHint(input: {
  count: number;
  check: Check;
  helper: NeverHelper | undefined;
  many: boolean;
  /** The example that says which cases fall through on purpose, or the ignore comment. */
  rest: { line: string; spelled: boolean; type: string | undefined };
}): string {
  const { count, check, helper, many, rest } = input;
  const n = String(count);
  const what = count === 1 ? "case" : "cases";
  const same = rest.spelled
    ? count === 1
      ? "if the `default` is right for it, say so"
      : `if these ${n} cases all mean the same, say which`
    : count === 1
      ? "if the `default` is right for it, say so above the `default`"
      : `if these ${n} cases all mean the same, say so above the \`default\``;
  const line = fitted((cut) => {
    // Core decides which fix, if any, is offered: the hint names the change, not the fix.
    const list =
      check.tag === undefined
        ? `list the ${what}, then put \`${checkCode(cut(check.target), helper)}\` in the \`default\``
        : `list the ${what}, then check a \`const\` of the tag in the \`default\``;
    return many ? `${same}, or ${list}:` : `${list}, or ${same}:`;
  });
  return [line, example([rest.line])].join("\n");
}

function completeHeadline(subject: string): string {
  return fitted(
    (cut) =>
      `\`default\` can't be reached today, but a new \`${cut(subject)}\` value would silently land here`,
  );
}

function completeHint(input: {
  check: Check;
  statement: string | undefined;
  sharing: string | undefined;
  /** The copy the sharing case gets, as one example line. */
  sharingBody: string | undefined;
}): string {
  const { check, statement, sharing, sharingBody } = input;
  const proof = satisfiesStatement(shorten(check.target, EXAMPLE_TEXT_MAX));
  const body = statement === undefined ? [] : [`  ${shorten(statement, EXAMPLE_TEXT_MAX)}`];
  if (check.tag !== undefined) {
    // The hook's dependencies stay as they are: the code reads the tag, not the whole object.
    return [
      `keep the fallback, and check a \`const\` of the tag so the hook's dependencies stay the same:`,
      example([
        `const ${check.target} = ${shorten(check.tag.subject, EXAMPLE_TEXT_MAX)};`,
        `switch (${check.target}) {`,
        "default:",
        `  ${proof}`,
      ]),
    ].join("\n");
  }
  if (sharing !== undefined) {
    return [
      `give \`${shorten(sharing, EXAMPLE_TEXT_MAX)}\` its own copy of the body, then let TypeScript check the fallback:`,
      example([
        shorten(sharing, EXAMPLE_TEXT_MAX),
        ...(sharingBody === undefined ? [] : [`  ${shorten(sharingBody, EXAMPLE_TEXT_MAX)}`]),
        "default:",
        `  ${proof}`,
      ]),
    ].join("\n");
  }
  return [
    `keep the fallback but let TypeScript check it:`,
    example(["default:", `  ${proof}`, ...body]),
  ].join("\n");
}

/**
 * A name for a `const` holding a computed subject: the name it reads last (`alertMode` for
 * `draft.alertMode ?? "none"`, `mode` for `getMode()`), else `value`.
 */
function constName(expression: ts.Expression): string {
  const inner = stripParentheses(expression);
  if (ts.isIdentifier(inner)) return inner.text;
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
  if (ts.isBinaryExpression(inner)) return constName(inner.left);
  if (ts.isConditionalExpression(inner)) return constName(inner.whenTrue);
  if (
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isAwaitExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  ) {
    return constName(inner.expression);
  }
  if (ts.isElementAccessExpression(inner)) return constName(inner.expression);
  if (ts.isCallExpression(inner)) {
    const called = constName(inner.expression);
    const rest = /^(?:get|read|compute|to)([A-Z].*)$/.exec(called)?.[1];
    return rest === undefined ? called : `${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  return "value";
}

/**
 * The fix line for a subject TypeScript does not narrow (`a ?? "none"`, `f()`): a check on it
 * cannot compile, so the value goes into a `const` first and the switch is on that.
 */
function computedHint(subject: ts.Expression, ctx: FileContext): string {
  const name = constName(subject);
  const shown = oneLineText(subject, ctx.sourceFile);
  // A comma would end the declaration early: `const x = a, b` declares `b` too.
  const value =
    ts.isBinaryExpression(subject) && subject.operatorToken.kind === ts.SyntaxKind.CommaToken
      ? `(${shown})`
      : shown;
  return fitted(
    (cut) =>
      `put it in a \`const\` first: \`const ${name} = ${cut(value)}; switch (${name}) …\`, then check \`${name}\` in the \`default\``,
  );
}

export const defaultHidesCases = defineRule({
  kind: "file",
  meta: {
    description:
      "A switch over a union handles every case, so a value added later fails to compile instead of falling into the default.",
    defaultSeverity: "error",
    tier: "core",
    group: "cases",
    options: {
      maxHidden: option.number({
        default: 5,
        min: 0,
        integer: true,
        description:
          'A `default` that hides more cases than this is reported as info: it often means "everything else".',
      }),
      ignore: option.strings({
        default: [],
        description:
          "Union type names (globs like *Event) whose switches are not checked: matched against the type of the value tested, or of the object whose tag is tested.",
      }),
      severities: option.severities({
        kinds: {
          complete: "every case is listed, and the default has no check",
          hidden: "the default hides up to maxHidden cases",
          "many-hidden": "the default hides more than maxHidden cases (info unless set here)",
        },
        description: "A severity per kind of finding.",
      }),
      projectTypesOnly: option.boolean({
        default: true,
        description:
          "Check only unions declared in the project, not in packages or TypeScript's lib: a member a library adds later is not a state the app designed.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const settings = {
      maxHidden: ctx.options.maxHidden,
      projectTypesOnly: ctx.options.projectTypesOnly,
      ignore: ctx.options.ignore,
    };
    const visit = (node: ts.Node): void => {
      if (ts.isSwitchStatement(node)) checkSwitch(node, settings, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});

type Settings = { maxHidden: number; projectTypesOnly: boolean; ignore: readonly string[] };

function checkSwitch(node: ts.SwitchStatement, settings: Settings, ctx: FileContext): void {
  const clauses = node.caseBlock.clauses;
  const fallback = clauses.find(ts.isDefaultClause);
  if (fallback === undefined) return;
  const subject = stripParentheses(node.expression);
  // `typeof x` gives the names of types, which `x` is not narrowed by: no check on `x` can say
  // that every name is handled, and `assertNever(typeof x)` does not compile.
  if (ts.isTypeOfExpression(subject)) return;
  // `switch (true)` tests conditions; its cases are not values of the subject.
  if (subject.kind === ts.SyntaxKind.TrueKeyword || subject.kind === ts.SyntaxKind.FalseKeyword)
    return;
  const literals = ctx.types.literalsOf(subject);
  if (literals === "not-finite") return;
  const subjectText = compactText(subject, ctx.sourceFile);
  const covered = coveredLabels(clauses, ctx);
  // The cases the `default` takes: a check against exactly these says they fall through on purpose.
  const fallsThrough =
    covered === undefined
      ? undefined
      : literals.map((literal) => literal.label).filter((label) => !covered.has(label));
  if (provesCompleteness(fallback.statements, subjectText, ctx, fallsThrough)) return;
  if (covered === undefined) return;
  const unresolved = unresolvedCheck(fallback.statements, subjectText, ctx);
  if (unresolved !== undefined) {
    const target = oneLineText(proofTarget(subject, ctx), ctx.sourceFile);
    ctx.unknown({
      node: fallback.getFirstToken(ctx.sourceFile) ?? fallback,
      message: `stateward cannot tell whether \`${oneLineText(unresolved.expression, ctx.sourceFile)}(…)\` checks every case of \`${oneLineText(subject, ctx.sourceFile)}\`: its type does not resolve`,
      hint: `make its import resolve (install or build the package that declares it), or put \`${satisfiesStatement(target)}\` first in the \`default\``,
    });
    return;
  }
  // A member a package adds in a later version is not a state the app designed.
  if (settings.projectTypesOnly && ctx.types.isLibraryType(subject)) return;
  if (ignoredType(subject, settings.ignore, ctx)) return;

  const shown = oneLineText(subject, ctx.sourceFile);
  const hidden = literals.filter((literal) => !covered.has(literal.label));
  const where = fallback.getFirstToken(ctx.sourceFile) ?? fallback;
  const many = hidden.length > settings.maxHidden;
  const headline =
    hidden.length > 0 ? hiddenHeadline(hidden, shown, settings.maxHidden) : completeHeadline(shown);
  // TypeScript narrows only a name or a property path: `a ?? "none"` or `f()` stays as wide in
  // the `default` as before the switch, so no check on it compiles.
  if (!isPlainReference(subject)) {
    ctx.report({
      node: where,
      message: headline,
      hint: computedHint(subject, ctx),
      ...findingKind(hidden.length, many),
    });
    return;
  }
  const target = proofTarget(subject, ctx);
  // TypeScript leaves `undefined` in `o?.kind` after every case, even `case undefined`, unless `o`
  // itself is narrowed: no check compiles, so asking for one would be a false positive.
  if (target === subject && ts.isOptionalChain(subject) && literals.some(isUndefined)) return;
  const forms = checkForms({ subject, target, statement: node, references: [subject], ctx });
  const [check] = forms;
  if (check === undefined) return;
  const helper = neverHelper(ctx);
  if (hidden.length > 0) {
    // Each check with the project's helper, then with `satisfies never`: core offers the first
    // form that compiles.
    const uses = helper === undefined ? [undefined] : [helper, undefined];
    const fix = withAlternatives(
      forms.flatMap((form) =>
        uses.map((use) =>
          listFix({ clause: fallback, clauses, hidden, check: form, helper: use, ctx }),
        ),
      ),
    );
    const rest = restExample({
      rule: RULE_NAME,
      frame: { before: "default: ", after: "" },
      subject: shown,
      type: restType({
        hidden: hidden.map((literal) => literal.label),
        spellings: enumSpellings(
          clauses.filter(ts.isCaseClause).map((c) => c.expression),
          ctx,
        ),
      }),
    });
    // The inline spelling keeps the `default` and its body: the type says which cases fall through.
    const restFix =
      rest.type === undefined
        ? undefined
        : proofFix(fallback, clauses, check, ctx, { subject: shown, type: rest.type });
    const fixes = [fix, restFix].filter((f) => f !== undefined);
    ctx.report({
      node: where,
      message: headline,
      hint: hiddenHint({ count: hidden.length, check, helper, many, rest }),
      ...findingKind(hidden.length, many),
      ...(fixes.length === 0 ? {} : { fixes }),
    });
    return;
  }
  const fix = withAlternatives(forms.map((form) => proofFix(fallback, clauses, form, ctx)));
  const sharing = sharingCases(fallback, clauses)
    .map((clause) => `case ${oneLineText(clause.expression, ctx.sourceFile)}:`)
    .join(" ");
  ctx.report({
    node: where,
    message: headline,
    hint: completeHint({
      check,
      statement:
        fallback.statements[0] === undefined
          ? undefined
          : oneLineText(fallback.statements[0], ctx.sourceFile),
      sharing: sharing === "" ? undefined : sharing,
      sharingBody: sharedCopy(fallback, clauses, ctx),
    }),
    ...findingKind(0, false),
    ...(fix === undefined ? {} : { fixes: [fix] }),
  });
}

/**
 * The finding's kind for the config's `severities`; a `default` hiding many cases is info unless
 * the config sets that kind.
 */
function findingKind(hidden: number, many: boolean): { findingKind: string; severity?: "info" } {
  if (hidden === 0) return { findingKind: "complete" };
  return many ? { findingKind: "many-hidden", severity: "info" } : { findingKind: "hidden" };
}
