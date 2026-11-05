import ts from "@stateward/core/typescript";
import {
  defineRule,
  option,
  type FileContext,
  type Fix,
  type NarrowingTest,
} from "@stateward/core";
import {
  checkCode,
  ignoredType,
  checkForms,
  checkStatements,
  enumSpellings,
  indentUnit,
  insertProof,
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
  valueCode,
  type Check,
  type NeverHelper,
  withAlternatives,
} from "./proof.js";
import {
  HEADLINE_MAX,
  HINT_MAX,
  compactText,
  fitted,
  fittedCases,
  fittedOneOf,
  oneLineText,
} from "./text.js";

const EXPLAIN = `# unions/if-chain-misses-case

An if / else if chain over a union handles every case, so a value added later fails to compile.

## Why

An \`if / else if\` chain over a union is a switch in other words, and it fails the same way. A chain that handles \`"idle"\` and \`"running"\` does nothing for \`"failed"\` or \`"retry"\`, and nothing for \`"cancelled"\` the day someone adds it. TypeScript does not say a word unless the chain ends with an \`else\` that checks for \`never\`.

## When to use it

To have TypeScript check a chain you mean to cover every case, end it with \`else { status satisfies never; }\` (or a call to your own \`never\` helper, \`else { ensureNever(status); }\`): a case added later then fails to compile at that line, and this rule has nothing more to say.

Much code handles only some values on purpose, so by default the rule reports only chains that look meant to cover every case: the ones where a missing case is most likely forgotten. It is on as an error in every preset. A chain that handles every case but has no \`never\` check is an error; a chain that leaves a case out is a guess, so it is a warning (\`severities\` changes either). To report every chain that leaves a case out, set \`report: "all"\` (see the end of this page). An early return (\`if (s.kind === "err") return;\`) is a single \`if\`, which this rule never checks.

## What it catches

A chain of two or more tests on the same value (\`s\`, \`s.kind\`, \`s?.kind\`, also joined with \`||\`): \`===\` against a literal, \`"prop" in s\`, \`typeof s === "…"\`, \`s instanceof C\`, or \`isX(s)\`. By default it reports the chain when:

- every case is handled, but the \`else\` has no \`never\` check, so a case added later would land there;
- the chain tests two or more cases and its \`else\` takes one or two cases nobody tested (as with a \`default\`, they were likely forgotten);
- the chain tests two or more cases, has no \`else\`, and misses exactly one case.

With \`report: "all"\` every one of these findings has the rule's severity, and it also reports an \`else\` that takes three or more untested cases, and a chain without an \`else\` that misses two or more. An \`else\` that takes more than 5 untested cases (option \`maxHidden\`) is reported as info: it often means "everything else" on purpose. To keep one, say which cases it takes: \`else { event.type satisfies "scroll" | "resize"; … }\` (a type that names exactly the cases that fall through, written out or as an alias; a case added later fails to compile there, and the rule is silent). \`Exclude<Event["type"], "click" | "key">\` is accepted too, as your stated choice, but it grows with the union: a case added later falls into the \`else\` again without a word, so write the cases out unless that is what you want. A type that names more or fewer cases keeps the finding, with the exact type in its hint. A second quick fix keeps the \`else\` and writes that check, with the cases that fall through today, as its first statement; saying "these cases all mean the same" is your decision, so \`--fix\` and "Fix all" never apply it. Or say why on the line above the \`else\`: \`// stateward-ignore unions/if-chain-misses-case: <why>\`.

Only unions declared in your project are checked: a member a package or TypeScript's lib adds later is not a state your app designed (option \`projectTypesOnly\`).

A chain that handles every case and has no \`else\` is fine: TypeScript already sees the remaining value as \`never\`. An \`else\` is fine when it does \`status satisfies never\` (also \`(status) satisfies never\` or \`void (status satisfies never)\`), assigns the value to a \`never\` variable, or passes it to a function whose parameter is \`never\`, such as your own \`ensureNever\`. For \`node.type === "frame"\` tests over a union of objects, TypeScript narrows \`node\` itself, so the check is \`node satisfies never\`.

### Bad

\`\`\`ts
if (status.kind === "idle") {
  start();
} else if (status.kind === "running") {
  watch();
} else if (status.kind === "failed") {
  report(status);
}
// "retry" is not handled
\`\`\`

### Good

\`\`\`ts
if (status.kind === "idle") {
  start();
} else if (status.kind === "running") {
  watch();
} else if (status.kind === "failed") {
  report(status);
} else if (status.kind === "retry") {
  again();
} else {
  status satisfies never;
}
\`\`\`

The check must run every time the \`else\` does: put it directly in the \`else\`, not inside an \`if\`, a loop, a \`try\` or a function.

### Fix

When every case is handled and only the check is missing, a quick fix adds \`status satisfies never;\` at the top of the \`else\` (\`void (type satisfies never);\` for a value named \`type\`, which would start a declaration); \`stateward check --fix\` applies it too. Inside \`useMemo\`, \`useCallback\`, \`useEffect\` or \`useLayoutEffect\`, when the chain reads only \`selectedNode.type\`, it tests \`const nodeType = selectedNode.type;\` instead and checks \`nodeType\`, so the hook's dependencies stay the same.

When the \`else\` hides cases, the quick fix "List the 2 hidden cases (same behaviour)" turns it into:

\`\`\`ts
} else if (status.kind === "failed" || status.kind === "retry") {
  return -1; // the old body
} else {
  status satisfies never;
  return -1;
}
\`\`\`

If the file has its own \`never\` helper, the new \`else\` calls it instead (\`return ensureNever(status);\`). Every case still does what it did, and a case added later fails to compile. \`--fix\` does not apply it: a value outside the type at run time (from an \`as\` cast or unchecked data) now skips the old body. It is offered when the hidden cases can be written as values (strings, numbers, booleans, enum members, \`null\`, \`undefined\`), or as \`typeof\` tests in a \`typeof\` chain. When cases are missing and there is no \`else\`, write them yourself.

Each quick fix is tried on a copy of your code first, in its forms in order (the \`const\` of the tag, the object, the value itself; your helper, then \`satisfies never\`), and offered only in the first form that compiles.

## What it does not catch

- By default, a chain that handles some values on purpose: an \`else\` that takes three or more untested cases, or no \`else\` and two or more cases missing.
- A single \`if\`.
- A chain that also uses other tests (\`!==\`, \`&&\`, \`<\`, a call that is not a type guard, \`a[i]\`), tests different values, or mixes \`===\` tests with \`typeof\` or \`in\` tests.
- A value whose type is not a union (\`any\`, \`unknown\`, an unconstrained generic).
- A chain without an \`else\` where only \`undefined\` or \`null\` is left and the code after the chain handles it.
- A chain that splits by shape (\`typeof\`, \`instanceof\`, \`Array.isArray\`) and leaves a set of strings or numbers to the \`else\`: the \`else\` handles them as one shape.
- \`s?.kind\` when \`s\` can be \`undefined\`: TypeScript keeps \`undefined\` after every test, so no \`never\` check can compile.
- A class with its own \`Symbol.hasInstance\`.

For your own type guards, the rule counts a member as handled when it fits the guard's type. TypeScript is stricter there, so in rare cases the rule misses a case; it never reports one that is not missing.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "unions/if-chain-misses-case": "off" } // or "warning"
rules: { "unions/if-chain-misses-case": ["error", { report: "all" }] } // every chain that leaves a case out
rules: { "unions/if-chain-misses-case": ["error", { projectTypesOnly: false }] } // packages' unions too
rules: { "unions/if-chain-misses-case": ["error", { ignore: ["*Event"] }] } // unions not checked
rules: { "unions/if-chain-misses-case": ["error", { severities: { "many-hidden": "warning" } }] } // per kind of finding
groups: { "guards/switches": "off" } // the whole group
\`\`\`
`;

/** One test of the chain, on the reference it narrows. */
type Test =
  | { form: "literal"; reference: ts.Expression; value: ts.Expression }
  | { form: "narrowing"; reference: ts.Expression; test: NarrowingTest };

/** What a chain covers: the cases of the union, and the labels its tests handle. */
type Coverage = { variants: readonly string[]; covered: ReadonlySet<string> };

function isStringLiteral(
  node: ts.Expression,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** What the developer writes for one value: a literal, `null`, `undefined`, or an enum member. */
function isValueExpression(node: ts.Expression, ctx: FileContext): boolean {
  const inner = stripParentheses(node);
  if (isStringLiteral(inner) || ts.isNumericLiteral(inner)) return true;
  if (
    inner.kind === ts.SyntaxKind.TrueKeyword ||
    inner.kind === ts.SyntaxKind.FalseKeyword ||
    inner.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(inner) && inner.text === "undefined") return true;
  if (
    ts.isPrefixUnaryExpression(inner) &&
    inner.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(inner.operand)
  ) {
    return true;
  }
  if (!ts.isPropertyAccessExpression(inner)) return false;
  const symbol = ctx.types.symbolAt(inner.name);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && ts.isEnumMember(declaration.node);
}

function parseEquality(
  left: ts.Expression,
  right: ts.Expression,
  ctx: FileContext,
): Test | undefined {
  const typeOfAgainst = (typed: ts.Expression, name: ts.Expression): Test | undefined => {
    if (!ts.isTypeOfExpression(typed) || !isStringLiteral(name)) return undefined;
    const reference = stripParentheses(typed.expression);
    if (!isPlainReference(reference)) return undefined;
    return { form: "narrowing", reference, test: { kind: "typeof", typeName: name.text } };
  };
  if (ts.isTypeOfExpression(left) || ts.isTypeOfExpression(right)) {
    return typeOfAgainst(left, right) ?? typeOfAgainst(right, left);
  }
  const leftIsValue = isValueExpression(left, ctx);
  const rightIsValue = isValueExpression(right, ctx);
  if (leftIsValue === rightIsValue) return undefined;
  const [reference, value] = rightIsValue ? [left, right] : [right, left];
  if (!isPlainReference(reference)) return undefined;
  return { form: "literal", reference, value };
}

/** One test of the chain, or undefined when it is not one of the forms the rule reads. */
function parseTest(expression: ts.Expression, ctx: FileContext): Test | undefined {
  const node = stripParentheses(expression);
  if (ts.isCallExpression(node)) {
    const argument = ctx.types.guardedArgument(node);
    const reference = argument === undefined ? undefined : stripParentheses(argument);
    if (reference === undefined || !isPlainReference(reference)) return undefined;
    return { form: "narrowing", reference, test: { kind: "guard", call: node } };
  }
  if (!ts.isBinaryExpression(node)) return undefined;
  const left = stripParentheses(node.left);
  const right = stripParentheses(node.right);
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken) return parseEquality(left, right, ctx);
  if (operator === ts.SyntaxKind.InKeyword) {
    if (!isStringLiteral(left) || !isPlainReference(right)) return undefined;
    return { form: "narrowing", reference: right, test: { kind: "in", property: left.text } };
  }
  if (operator === ts.SyntaxKind.InstanceOfKeyword) {
    if (!isPlainReference(left) || !isPlainReference(right)) return undefined;
    return {
      form: "narrowing",
      reference: left,
      test: { kind: "instanceof", constructorExpression: right },
    };
  }
  return undefined;
}

/** The tests a condition is made of: the operands of `||`, or the condition itself. */
function disjuncts(condition: ts.Expression): readonly ts.Expression[] {
  const node = stripParentheses(condition);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [...disjuncts(node.left), ...disjuncts(node.right)];
  }
  return [node];
}

/** Every test of every condition, or undefined when one of them is not a test the rule reads. */
function parseChain(conditions: readonly ts.Expression[], ctx: FileContext): Test[] | undefined {
  const tests: Test[] = [];
  for (const condition of conditions) {
    for (const part of disjuncts(condition)) {
      const test = parseTest(part, ctx);
      if (test === undefined) return undefined;
      tests.push(test);
    }
  }
  return tests;
}

/**
 * The cases of the union and those the tests handle. Undefined when the chain cannot be judged: a
 * type that is not a finite union, a value that is not one literal, a narrowing TypeScript's own
 * rules would settle differently.
 */
function coverageOf(tests: readonly Test[], ctx: FileContext): Coverage | undefined {
  const [first] = tests;
  if (first === undefined) return undefined;
  const covered = new Set<string>();
  if (first.form === "literal") {
    const literals = ctx.types.literalsOf(first.reference);
    if (literals === "not-finite") return undefined;
    const labels = new Set(literals.map((literal) => literal.label));
    for (const test of tests) {
      if (test.form !== "literal") return undefined;
      const values = ctx.types.literalsOf(test.value);
      // A value of several literals (`x === mode`) matches only one of them at run time.
      const [only] = values === "not-finite" ? [] : values;
      if (only === undefined || values.length !== 1) return undefined;
      // `level === "high"` against an enum: the value is not a member of the union as written.
      if (!labels.has(only.label)) return undefined;
      covered.add(only.label);
    }
    return { variants: literals.map((literal) => literal.label), covered };
  }
  let variants: readonly string[] | undefined;
  for (const test of tests) {
    if (test.form !== "narrowing") return undefined;
    const narrowed = ctx.types.narrowedBy(test.reference, test.test);
    if (narrowed === "undecided") return undefined;
    // The first test sees the whole union; later ones see what the earlier tests left.
    variants ??= narrowed.members;
    for (const label of narrowed.removed) covered.add(label);
  }
  return variants === undefined ? undefined : { variants, covered };
}

/** `false` and `true` together are `boolean`, which is how a `typeof` chain names them. */
function shownLabels(missing: readonly string[], form: Test["form"]): readonly string[] {
  if (form !== "narrowing" || !missing.includes("false") || !missing.includes("true")) {
    return missing;
  }
  return [...missing.filter((label) => label !== "false" && label !== "true"), "boolean"].sort();
}

function missingHeadline(missing: readonly string[], subject: string, maxHidden: number): string {
  const noun = missing.length === 1 ? "case" : "cases";
  return fittedCases(
    HEADLINE_MAX,
    missing,
    maxHidden,
    (cut, labels) =>
      `this chain does not handle ${String(missing.length)} ${noun} of \`${cut(subject)}\`${labels}`,
  );
}

/** How a hint ends a chain with a check: the project's own helper, else `satisfies never`. */
function endWith(target: string, helper: NeverHelper | undefined): string {
  return `\`else { ${checkCode(target, helper)} }\``;
}

function missingHint(
  missing: readonly string[],
  target: string,
  helper: NeverHelper | undefined,
): string {
  const them = missing.length === 1 ? "it" : "them";
  return fittedOneOf(HINT_MAX, [
    (cut) => `add \`else if\` branches for ${them}, then end with ${endWith(cut(target), helper)}`,
  ]);
}

function hiddenHeadline(missing: readonly string[], subject: string, maxHidden: number): string {
  const noun = missing.length === 1 ? "case" : "cases";
  return fittedCases(
    HEADLINE_MAX,
    missing,
    maxHidden,
    (cut, labels) =>
      `this \`else\` hides ${String(missing.length)} ${noun} of \`${cut(subject)}\`${labels}`,
  );
}

const RULE_NAME = "if-chain-misses-case";

/**
 * The two ways out of an `else` that hides cases: test them, or say in an ignore comment why the
 * `else` is right for all of them. Above `maxHidden` cases the second comes first.
 */
function hiddenHint(input: {
  missing: readonly string[];
  check: Check;
  helper: NeverHelper | undefined;
  many: boolean;
  /** The example that says which cases fall through on purpose, or the ignore comment. */
  rest: { line: string; spelled: boolean; type: string | undefined };
}): string {
  const { missing, check, helper, many, rest } = input;
  const n = String(missing.length);
  const same = rest.spelled
    ? missing.length === 1
      ? "if the `else` is right for it, say so"
      : `if these ${n} cases all mean the same, say which`
    : missing.length === 1
      ? "if the `else` is right for it, say so above the `else`"
      : `if these ${n} cases all mean the same, say so above the \`else\``;
  // Core decides which fix, if any, is offered: the hint names the change, not the fix.
  const end = (cut: (text: string) => string): string =>
    check.tag === undefined
      ? `then end with ${endWith(cut(check.target), helper)}`
      : "then check a `const` of the tag in the `else`";
  const line = fitted((cut) => {
    const list = `add \`else if\` branches, ${end(cut)}`;
    return many ? `${same}, or ${list}:` : `${list}, or ${same}:`;
  });
  return [line, `    ${rest.line}`].join("\n");
}

function completeHeadline(subject: string): string {
  return fitted((cut) => `this \`else\` will hide any case added to \`${cut(subject)}\` later`);
}

function completeHint(check: Check): string {
  if (check.tag !== undefined) {
    // The hook's dependencies stay as they are: the code reads the tag, not the whole object.
    return fitted(
      (cut) =>
        `test \`const ${check.target} = ${cut(check.tag?.subject ?? "")}\` instead, and put \`${satisfiesStatement(check.target)}\` first in the \`else\``,
    );
  }
  return fitted(
    (cut) =>
      `let TypeScript check it: put \`${satisfiesStatement(cut(check.target))}\` first in the \`else\``,
  );
}

/** `undefined` and `null`: a value that is absent rather than a case of its own. */
const ABSENT: ReadonlySet<string> = new Set(["undefined", "null"]);

/** Whether a statement follows the chain in its block: code that runs for every case, the absent one too. */
function codeFollows(start: ts.IfStatement): boolean {
  const parent = start.parent;
  if (!ts.isBlock(parent) && !ts.isSourceFile(parent) && !ts.isCaseOrDefaultClause(parent)) {
    return false;
  }
  const index = parent.statements.findIndex((statement) => statement === start);
  return parent.statements.slice(index + 1).some((statement) => !ts.isEmptyStatement(statement));
}

/** A label of one string or number literal: what a `typeof` or shape test cannot tell apart. */
function isPrimitiveLiteral(label: string): boolean {
  return label.startsWith('"') || /^-?\d/.test(label);
}

function continuesChain(node: ts.IfStatement): boolean {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

export const ifChainMissesCase = defineRule({
  kind: "file",
  meta: {
    description:
      "An if / else if chain over a union handles every case, so a value added later fails to compile.",
    defaultSeverity: "error",
    tier: "core",
    group: "cases",
    options: {
      report: option.string({
        default: "likely-mistakes",
        oneOf: ["likely-mistakes", "all"],
        description:
          '"likely-mistakes": only chains that look meant to handle every case. "all": every chain that leaves a case out.',
      }),
      maxHidden: option.number({
        default: 5,
        min: 0,
        integer: true,
        description:
          'An `else` that hides more cases than this is reported as info: it often means "everything else".',
      }),
      ignore: option.strings({
        default: [],
        description:
          "Union type names (globs like *Event) whose chains are not checked: matched against the type of the value tested, or of the object whose tag is tested.",
      }),
      severities: option.severities({
        kinds: {
          complete: "every case is handled, and the else has no check",
          missing: "a chain without an else misses cases",
          hidden: "the else hides up to maxHidden cases",
          "many-hidden": "the else hides more than maxHidden cases (info unless set here)",
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
    const settings: Settings = {
      reportAll: ctx.options.report === "all",
      maxHidden: ctx.options.maxHidden,
      projectTypesOnly: ctx.options.projectTypesOnly,
      ignore: ctx.options.ignore,
    };
    const visit = (node: ts.Node): void => {
      // The `if` of an `else if` belongs to the chain that its first `if` starts.
      if (ts.isIfStatement(node) && !continuesChain(node)) checkChain(node, settings, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});

/**
 * Whether a chain that leaves cases out looks meant to handle every case. Much code handles only
 * some values on purpose; a chain that tests two or more cases and leaves out one (no `else`) or
 * at most two (to an `else`) is more likely a case forgotten, as with a switch `default`.
 */
function looksMeantComplete(tested: number, missing: number, hasElse: boolean): boolean {
  if (tested < LIKELY_MIN_TESTED) return false;
  return missing <= (hasElse ? LIKELY_MAX_HIDDEN : LIKELY_MAX_MISSING);
}

const LIKELY_MIN_TESTED = 2;
/** An `else` that takes three or more cases nobody tested is "everything else", on purpose. */
const LIKELY_MAX_HIDDEN = 2;
const LIKELY_MAX_MISSING = 1;

/**
 * In "likely-mistakes" mode a chain that leaves cases out is reported because it looks meant to
 * handle every case: a guess, so a warning at most. With `report: "all"` the developer asked
 * for every such chain, and it keeps the rule's severity.
 */
function guessed(settings: Settings): { severity?: "warning" } {
  return settings.reportAll ? {} : { severity: "warning" };
}

type Settings = {
  reportAll: boolean;
  maxHidden: number;
  projectTypesOnly: boolean;
  ignore: readonly string[];
};

function checkChain(start: ts.IfStatement, settings: Settings, ctx: FileContext): void {
  const links: ts.IfStatement[] = [start];
  for (
    let last = start;
    last.elseStatement !== undefined && ts.isIfStatement(last.elseStatement);
  ) {
    last = last.elseStatement;
    links.push(last);
  }
  const end = links[links.length - 1];
  if (end === undefined || links.length < 2) return;

  const tests = parseChain(
    links.map((link) => link.expression),
    ctx,
  );
  const first = tests?.[0];
  if (tests === undefined || first === undefined) return;
  const referenceText = compactText(first.reference, ctx.sourceFile);
  if (tests.some((test) => compactText(test.reference, ctx.sourceFile) !== referenceText)) return;

  const coverage = coverageOf(tests, ctx);
  if (coverage === undefined || coverage.variants.length < 2) return;
  const fallback = end.elseStatement;
  const fallbackStatements =
    fallback === undefined ? [] : ts.isBlock(fallback) ? fallback.statements : [fallback];
  // The cases the `else` takes: a check against exactly these says they fall through on purpose.
  const fallsThrough =
    first.form === "literal"
      ? coverage.variants.filter((label) => !coverage.covered.has(label))
      : undefined;
  if (
    fallback !== undefined &&
    provesCompleteness(fallbackStatements, referenceText, ctx, fallsThrough)
  ) {
    return;
  }
  // A member a package adds in a later version is not a state the app designed.
  if (settings.projectTypesOnly && ctx.types.isLibraryType(first.reference)) return;
  if (ignoredType(first.reference, settings.ignore, ctx)) return;

  const subject = first.reference;
  // Only a discriminated union is narrowed through its `kind`, so only then is the proof on `s`.
  const target = first.form === "literal" ? proofTarget(subject, ctx) : subject;
  // TypeScript leaves `undefined` in `s?.kind` after every test: no test on the same reference
  // can handle it, so no chain on it can be completed as asked.
  if (ts.isOptionalChain(subject) && coverage.variants.includes("undefined")) return;

  const missing = shownLabels(
    coverage.variants.filter((label) => !coverage.covered.has(label)),
    first.form,
  );
  const shown = oneLineText(subject, ctx.sourceFile);
  const proves = oneLineText(target, ctx.sourceFile);
  const helper = neverHelper(ctx);
  const forms = checkForms({
    subject,
    target,
    statement: start,
    references: tests.map((test) => test.reference),
    ctx,
  });
  const [check] = forms;
  if (check === undefined) return;
  const elseKeyword =
    fallback === undefined
      ? undefined
      : end.getChildren(ctx.sourceFile).find((child) => child.kind === ts.SyntaxKind.ElseKeyword);

  if (missing.length > 0) {
    // The absent case falls through to the code after the chain, which handles it.
    if (
      fallback === undefined &&
      missing.every((label) => ABSENT.has(label)) &&
      codeFollows(start)
    ) {
      return;
    }
    // A chain split by shape (`typeof`, `Array.isArray`, `instanceof`) leaves the `else` one
    // shape: the literals of a string or number type it holds are not cases the chain hides.
    if (
      fallback !== undefined &&
      first.form === "narrowing" &&
      missing.every((label) => isPrimitiveLiteral(label))
    ) {
      return;
    }
    if (
      !settings.reportAll &&
      !looksMeantComplete(coverage.covered.size, missing.length, fallback !== undefined)
    ) {
      return;
    }
    if (fallback === undefined || elseKeyword === undefined) {
      const where = start.getFirstToken(ctx.sourceFile) ?? start;
      ctx.report({
        node: where,
        message: missingHeadline(missing, shown, settings.maxHidden),
        hint: missingHint(missing, proves, helper),
        findingKind: "missing",
        ...guessed(settings),
      });
      return;
    }
    // Each check with the project's helper, then with `satisfies never`: core offers the first
    // form that compiles.
    const uses = helper === undefined ? [undefined] : [helper, undefined];
    const fix = withAlternatives(
      forms.flatMap((form) =>
        uses.map((use) =>
          listFix({ start, tests, missing, fallback, elseKeyword, check: form, helper: use, ctx }),
        ),
      ),
    );
    const many = missing.length > settings.maxHidden;
    const rest = restExample({
      rule: RULE_NAME,
      frame: { before: "else { ", after: " }" },
      subject: shown,
      type:
        first.form === "literal"
          ? restType({
              hidden: missing,
              spellings: enumSpellings(
                tests.flatMap((test) => (test.form === "literal" ? [test.value] : [])),
                ctx,
              ),
            })
          : undefined,
    });
    // The inline spelling keeps the `else` and its body: the type says which cases fall through.
    const [firstInElse] = fallbackStatements;
    const restFix =
      rest.type !== undefined && ts.isBlock(fallback) && firstInElse !== undefined
        ? insertProof({
            first: firstInElse,
            opener: fallback.getFirstToken(ctx.sourceFile),
            outer: elseKeyword,
            check,
            place: "else",
            rest: { subject: shown, type: rest.type },
            ctx,
          })
        : undefined;
    const fixes = [fix, restFix].filter((f) => f !== undefined);
    ctx.report({
      node: elseKeyword,
      message: hiddenHeadline(missing, shown, settings.maxHidden),
      hint: hiddenHint({ missing, check, helper, many, rest }),
      ...(many
        ? { findingKind: "many-hidden", severity: "info" as const }
        : { findingKind: "hidden", ...guessed(settings) }),
      ...(fixes.length === 0 ? {} : { fixes }),
    });
    return;
  }
  // Every case is handled: TypeScript narrows the rest to `never` by itself, so only an `else`
  // that proves nothing is a problem.
  if (fallback === undefined || elseKeyword === undefined) return;
  const [firstStatement] = fallbackStatements;
  const fix =
    ts.isBlock(fallback) && firstStatement !== undefined
      ? withAlternatives(
          forms.map((form) =>
            insertProof({
              first: firstStatement,
              opener: fallback.getFirstToken(ctx.sourceFile),
              outer: elseKeyword,
              check: form,
              place: "else",
              ctx,
            }),
          ),
        )
      : undefined;
  ctx.report({
    node: elseKeyword,
    message: completeHeadline(shown),
    findingKind: "complete",
    // Without the fix nothing declares the tag's `const`: the hint names what exists.
    hint: completeHint(fix === undefined ? { target: proves, tag: undefined, setup: [] } : check),
    ...(fix === undefined ? {} : { fixes: [fix] }),
  });
}

/** The `typeof` name that tests exactly one hidden member of a `typeof` chain. */
function typeOfName(label: string): string | undefined {
  if (label.startsWith('"')) return "string";
  if (/^-?\d/.test(label)) return "number";
  if (label === "true" || label === "false") return "boolean";
  return ["string", "number", "bigint", "boolean", "symbol", "undefined"].includes(label)
    ? label
    : undefined;
}

/**
 * The tests for the hidden members, written as the chain writes its own: `s.kind === "x"` (or
 * `"x" === s.kind`) for a chain of literals, `typeof s === "number"` for a `typeof` chain.
 * Undefined when a member cannot be written as one test (an object type, an `in` or guard chain).
 */
function hiddenTests(
  start: ts.IfStatement,
  tests: readonly Test[],
  missing: readonly string[],
  /** What the tests are written on: the reference, or the `const` that replaces it. */
  reference: string,
  ctx: FileContext,
): string[] | undefined {
  const [first] = tests;
  const [firstNode] = disjuncts(start.expression);
  if (first === undefined || firstNode === undefined || !ts.isBinaryExpression(firstNode)) {
    return undefined;
  }
  // The developer's order: `x === "a"` or `"a" === x`.
  const left = stripParentheses(firstNode.left);
  const valueFirst = left !== first.reference && !ts.isTypeOfExpression(left);
  const equals = (value: string): string =>
    valueFirst ? `${value} === ${reference}` : `${reference} === ${value}`;
  if (first.form === "literal") {
    const spellings = enumSpellings(
      tests.flatMap((test) => (test.form === "literal" ? [test.value] : [])),
      ctx,
    );
    const values = missing.map((label) => valueCode(label, spellings));
    return values.every((value) => value !== undefined) ? values.map(equals) : undefined;
  }
  if (!tests.every((test) => test.form === "narrowing" && test.test.kind === "typeof")) {
    return undefined;
  }
  const written = new Set<string>();
  for (const label of missing) {
    // `typeof null` is "object", which would also take objects: `null` is tested by value.
    const name = label === "null" ? undefined : typeOfName(label);
    if (label === "null") written.add(equals("null"));
    else if (name === undefined) return undefined;
    else
      written.add(
        valueFirst ? `"${name}" === typeof ${reference}` : `typeof ${reference} === "${name}"`,
      );
  }
  return [...written];
}

/**
 * Turns the final `else {body}` into `else if (<the hidden cases>) {body} else { s satisfies never; }`.
 * Every value of the type takes the same path as before; only a value outside the type now skips
 * the old body, so the fix is not safe for `--fix`.
 */
function listFix(input: {
  start: ts.IfStatement;
  tests: readonly Test[];
  missing: readonly string[];
  fallback: ts.Statement;
  elseKeyword: ts.Node;
  check: Check;
  helper: NeverHelper | undefined;
  ctx: FileContext;
}): Fix | undefined {
  const { start, tests, missing, fallback, elseKeyword, check, helper, ctx } = input;
  const [first] = tests;
  if (first === undefined) return undefined;
  const reference =
    check.tag === undefined ? oneLineText(first.reference, ctx.sourceFile) : check.target;
  const written = hiddenTests(start, tests, missing, reference, ctx);
  if (written === undefined || written.length === 0) return undefined;
  const text = ctx.sourceFile.text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = leadingSpace(text, fallback.end - 1);
  // The new `else` ends as the old one did, so a function that returned there still does.
  const jump = jumpToCopy(ts.isBlock(fallback) ? fallback.statements : [fallback]);
  if (jump === undefined) return undefined;
  const inner = indent + indentUnit(indent);
  const body = checkStatements({
    target: check.target,
    helper,
    jump,
    inSwitch: false,
    sourceFile: ctx.sourceFile,
  })
    .map((line) => `${eol}${inner}${line}`)
    .join("");
  // After a block, `} else {` as usual; after a bare statement, the `else` starts its own line.
  const before = ts.isBlock(fallback) ? " " : `${eol}${indent}`;
  const closing = `${before}else {${body}${eol}${indent}}`;
  return {
    title: listTitle(written.length),
    edits: [
      ...check.setup,
      {
        location: { file: ctx.file, start: elseKeyword.end, end: elseKeyword.end },
        newText: ` if (${written.join(" || ")})`,
      },
      { location: { file: ctx.file, start: fallback.end, end: fallback.end }, newText: closing },
    ],
  };
}
