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

A case added to the union later goes to the last \`else\` with no compile error; testing every case and checking the rest with \`never\` makes the chain fail to compile.

\`\`\`ts example-bad
type Job =
  | { kind: "idle" }
  | { kind: "running"; progress: number }
  | { kind: "failed"; error: string };

export function describe(job: Job): string {
  if (job.kind === "idle") {
    return "Waiting";
  } else if (job.kind === "running") {
    return \`\${String(job.progress)}%\`;
  } else {
    return "Done";
  }
}
\`\`\`

Test every case, and end the chain with an \`else\` that checks for \`never\`:

\`\`\`ts example-good
type Job =
  | { kind: "idle" }
  | { kind: "running"; progress: number }
  | { kind: "failed"; error: string };

export function describe(job: Job): string {
  if (job.kind === "idle") {
    return "Waiting";
  } else if (job.kind === "running") {
    return \`\${String(job.progress)}%\`;
  } else if (job.kind === "failed") {
    return \`Failed: \${job.error}\`;
  } else {
    job satisfies never;
    return "Done";
  }
}
\`\`\`

The editor offers quick fixes. When every case is tested and only the check is missing, one adds \`job satisfies never;\` at the top of the \`else\`; \`stateward check --fix\` applies it too. When the \`else\` takes untested cases, "List the missing case (same behaviour)" tests the cases in a new \`else if\` that runs the old body, and adds an \`else\` with the check (or a call to your own \`never\` helper, such as \`ensureNever(job)\`, when the file has one). \`--fix\` does not apply that one: a value outside the type at run time (from an \`as\` cast or unchecked data) would now skip the old body. It is offered when the hidden cases can be written as values, or as \`typeof\` tests in a \`typeof\` chain. When cases are missing and there is no \`else\`, write them yourself. As with \`unions/default-hides-cases\`, a value named \`type\` gets \`void (type satisfies never);\`, a chain on \`node.type\` inside a React hook tests a \`const\` of it so the hook's dependencies stay the same, and each fix is offered only in a form that compiles on a copy of your code.

## Why it matters

An \`if / else if\` chain over a union is a switch in other words, and it fails the same way. A chain that handles \`"idle"\` and \`"running"\` lets \`"failed"\` fall into the last branch, and does the same for \`"cancelled"\` the day someone adds it. TypeScript says nothing unless the chain ends with an \`else\` that checks for \`never\`; with one, a case added later fails to compile at that line.

## What it does not catch

Much code handles only some values on purpose, so by default the rule reports only the chains that look meant to cover every case (two or more tests on the same value):

- every case is handled, but the \`else\` has no \`never\` check, so a case added later would land there (an error);
- the \`else\` takes one or two cases no branch tests (a warning: probably missed, but it is a guess);
- there is no \`else\`, and exactly one case is missing (a warning).

So by default it does not report an \`else\` that takes three or more untested cases, and on a chain without an \`else\` that misses two or more. Set \`report: "all"\` to report those too; an \`else\` that takes more than 5 untested cases (\`maxHidden\`) is then info, since it often means "everything else" on purpose. It also does not check:

- A single \`if\`, such as an early return (\`if (s.kind === "err") return;\`).
- A chain that also uses other tests (\`!==\`, \`&&\`, \`<\`, a call that is not a type guard, \`a[i]\`), tests different values, or mixes \`===\` tests with \`typeof\` or \`in\` tests.
- A value whose type is not a union (\`any\`, \`unknown\`, an unconstrained generic), or a union declared in a package or TypeScript's lib (set \`projectTypesOnly: false\` for those).
- A chain without an \`else\` where only \`undefined\` or \`null\` is left and the code after the chain handles it.
- A chain that splits by shape (\`typeof\`, \`instanceof\`, \`Array.isArray\`) and leaves a set of strings or numbers to the \`else\`: the \`else\` handles them as one shape.
- \`s?.kind\` when \`s\` can be \`undefined\`: TypeScript keeps \`undefined\` after every test, so no \`never\` check can compile.
- A class with its own \`Symbol.hasInstance\`.

For your own type guards, the rule counts a member as handled when it fits the guard's type. TypeScript is stricter there, so in rare cases the rule misses a case; it never reports one that is not missing.

## Getting the best from it

The tests it reads are \`===\` against a literal, \`"prop" in s\`, \`typeof s === "…"\`, \`s instanceof C\` and your own type guards \`isX(s)\`, on \`s\`, \`s.kind\` or \`s?.kind\`, also joined with \`||\`. A chain that handles every case and has no \`else\` is fine: TypeScript already sees the rest as \`never\`. An \`else\` is fine when its first statement is \`job satisfies never\` (also \`(job) satisfies never\` or \`void (job satisfies never)\`), assigns the value to a \`never\` variable, or passes it to a function whose parameter is \`never\`. For \`node.type === "frame"\` tests over a union of objects, TypeScript narrows \`node\` itself, so the check is \`node satisfies never\`. The check must run every time the \`else\` does: put it directly in the \`else\`, not inside an \`if\`, a loop, a \`try\` or a function.

When the cases the \`else\` takes really all mean the same, say which they are: \`else { event.type satisfies "scroll" | "resize"; … }\`, written out or as an alias. A case added later then fails to compile there, and the rule is silent. A type that names more or fewer cases keeps the finding, with the exact type in its hint. \`Exclude<Event["type"], "click" | "key">\` is accepted as your choice, but it grows with the union, so a new case falls into the \`else\` again without a word. A quick fix writes this check with today's cases; it is your decision, so \`--fix\` and "Fix all" never apply it. Or say why above the \`else\`: \`// stateward-ignore unions/if-chain-misses-case: <why>\`.

## Turn it on or off

\`\`\`ts
rules: { "unions/if-chain-misses-case": "off" } // or "warning"
rules: { "unions/if-chain-misses-case": ["error", { report: "all" }] } // every chain that leaves a case out
rules: { "unions/if-chain-misses-case": ["error", { severities: { missing: "error" } }] } // per kind of finding
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
  return fittedCases(
    HEADLINE_MAX,
    missing,
    maxHidden,
    (cut, labels) => `\`if\` chain does not handle ${labels} of \`${cut(subject)}\``,
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
  const [verb, them] = missing.length === 1 ? ["is", "it"] : ["are", "them"];
  return fittedCases(
    HEADLINE_MAX,
    missing,
    maxHidden,
    (cut, labels) =>
      `${labels} of \`${cut(subject)}\` ${verb} not tested; \`else\` handles ${them}`,
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
      ? "name it in the `else` instead, if that is where it belongs"
      : `name the ${n} cases in the \`else\` if they all mean the same`
    : missing.length === 1
      ? "say why above the `else` instead, if that is where it belongs"
      : `say why above the \`else\` if the ${n} cases all mean the same`;
  // Core decides which fix, if any, is offered: the hint names the change, not the fix.
  const end = (cut: (text: string) => string): string =>
    check.tag === undefined
      ? `then end with ${endWith(cut(check.target), helper)}`
      : "then check a `const` of the tag in the `else`";
  const line = fitted((cut) => {
    const list = `add \`else if\` branches, ${end(cut)}`;
    return many ? `${same}; otherwise ${list}:` : `${list}; or ${same}:`;
  });
  return [line, `    ${rest.line}`].join("\n");
}

function completeHeadline(subject: string): string {
  return fitted((cut) => `\`else\` is unreachable: every case of \`${cut(subject)}\` is tested`);
}

function completeHint(check: Check): string {
  if (check.tag !== undefined) {
    // The hook's dependencies stay as they are: the code reads the tag, not the whole object.
    return fitted(
      (cut) =>
        `test \`const ${check.target} = ${cut(check.tag?.subject ?? "")}\` instead, and put \`${satisfiesStatement(check.target)}\` first in the \`else\`, so a case added later fails to compile`,
    );
  }
  return fitted(
    (cut) =>
      `put \`${satisfiesStatement(cut(check.target))}\` first in the \`else\`, so a case added later fails to compile`,
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
      "A case added to the union later goes to the last `else` with no compile error; testing every case and checking the rest with `never` makes the chain fail to compile.",
    summary: "an `if` / `else if` chain over a union that misses a case or has no `never` check",
    defaultSeverity: "error",
    tier: "core",
    group: "cases",
    fixNeedsStrictNulls: true,
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
          'An `else` that handles more untested cases than this is reported as info: it often means "everything else".',
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
          hidden: "the else handles up to maxHidden untested cases",
          "many-hidden":
            "the else handles more than maxHidden untested cases (info unless set here)",
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
