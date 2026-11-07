import ts from "@stateward/core/typescript";
import { defineRule } from "@stateward/core";
import type { FileContext, Fix, Json } from "@stateward/core";
import { summarizeOnce } from "./inference/project.js";
import { REASON } from "./inference/summarize.js";
import { analyse, collected, evaluate } from "./inference/solve.js";
import type { Analysis } from "./inference/solve.js";
import { each, fieldsOf, isString, readStrings, spanOf } from "./inference/summary.js";
import type { Effect, Span, ThrowsSummary } from "./inference/summary.js";
import { throwsOf } from "./react/boundaries.js";
import {
  handsOnCaught,
  isFunctionBoundary,
  someRunning,
  stripParentheses,
  testsCaught,
} from "./syntax.js";
import { fitted, oneLine, shorten } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "catch";

const EXPLAIN = `# errors/narrow-try

A bug in code inside a \`try\` meant for another call is caught and reported as that call's failure; moving the code after the \`try\` keeps the two apart.

\`\`\`ts example-bad
class RequestError extends Error {}
declare function showError(error: unknown): void;

async function savePlan(plan: string): Promise<void> {
  const response = await fetch("/api/plans", { method: "POST", body: plan });
  if (!response.ok) throw new RequestError(String(response.status));
}

export async function submit(plan: string, close: () => void): Promise<void> {
  try {
    await savePlan(plan);
    close();
  } catch (e) {
    showError(e);
    return;
  }
}
\`\`\`

Keep only the call the \`try\` is for inside it, and move the rest after it:

\`\`\`ts example-good
class RequestError extends Error {}
declare function showError(error: unknown): void;

async function savePlan(plan: string): Promise<void> {
  const response = await fetch("/api/plans", { method: "POST", body: plan });
  if (!response.ok) throw new RequestError(String(response.status));
}

export async function submit(plan: string, close: () => void): Promise<void> {
  try {
    await savePlan(plan);
  } catch (e) {
    showError(e);
    return;
  }
  close();
}
\`\`\`

The quick fix moves the lines after the \`try\`. It is offered only when the move keeps what runs the same for every outcome but a bug: the \`catch\` ends with \`return\` or \`throw\`, there is no \`finally\`, and the moved lines use nothing declared in the \`try\`. Where they use the result, declare it before the \`try\` (\`let plan: Plan;\`), assign it inside, and return from the \`catch\`.

## Why it matters

The \`catch\` is for a failed save. When \`close\` has a bug (it reads a property of \`undefined\`, say), the \`TypeError\` is handled like a failed request: the user sees "Could not save", the console shows nothing useful, and the bug is never reported. With only the request inside the \`try\`, a bug in the code after it surfaces as the bug it is.

## What it does not catch

It needs a call that can fail as expected: one that throws a known error class (\`throw new RequestError(…)\` in your code, \`@throws\`, a built-in like \`JSON.parse\` or \`new URL\`), an awaited call into a package whose errors are not all known, or an awaited call whose rejection is not known to be nothing. The message names it. A package call that is not awaited (\`toast.success(…)\`) is not one; with no such call the rule says nothing. After it, it reports the first line that calls your own code: a function of the project given data the \`try\` got (\`openEditor(plan)\`), or a callback the function was given (\`close()\`). It is silent on:

- lines that only read, test or default what the \`try\` got (\`setTitle(plan.title)\`, \`if ("items" in data)\`, \`data.items ?? []\`), \`break\` and \`continue\`, store dispatches (\`dispatch(addNotification(…))\`), and a promise's own \`resolve(…)\`: these are mostly inside the \`try\` on purpose;
- lines that only use built-ins (\`seen.set(id, host)\`) or cannot fail (\`return true;\`);
- a \`catch\` that tests the error (\`instanceof\`, \`e.name === …\`, a type guard), rethrows it, or hands it to \`reject(e)\` or another callback it was given: it already lets bugs through;
- what \`JSON.parse\` or \`await response.json()\` gives: a value of the wrong shape is the same failure as bad JSON, which the \`catch\` is for (a callback given it, \`onEvent(event)\`, is still reported). A value declared \`unknown\` is not data either, since TypeScript makes you test it first;
- code in a callback written inside the \`try\`: when what it throws is not known, the rule assumes the worst and reports nothing.

A limit: an awaited result of your own function (\`result.success\` after \`await convert(…)\`) counts as data too; the rule does not tell a typed result from a response.

ESLint, typescript-eslint, eslint-plugin-unicorn and Biome have no rule about how wide a \`try\` is: their catch rules are about empty catches, catches that only rethrow, and the catch variable.

## Getting the best from it

It works best where your functions throw classes or document \`@throws\`, and with packages stateward knows (\`stateward deps\`): it then knows which call in the \`try\` can fail as expected.

## Turn it on or off

It is an add-on: in some code styles most \`try\` blocks hold the whole success path on purpose, and then it is noise. Use it to review how wide your \`try\` blocks are:

\`\`\`ts
addons: ["errors/narrow-try"]
overrides: [{ files: ["src/scripts/**"], rules: { "errors/narrow-try": "off" } }] // one folder
\`\`\`
`;

/** A line of code is shown whole up to this length, then cut: the headline stays readable. */
const LINE_MAX = 60;

// ---- summary -------------------------------------------------------------------------------------

/** One statement of a `try` block, as far as moving it is concerned. */
type Line = {
  readonly at: Span;
  /** The statement on one line, for the message. */
  readonly text: string;
  /** The source from the end of the statement before it (or the `{`) to its end: what a move takes. */
  readonly raw: string;
  /**
   * It can be reported: a statement that calls something (an expression, a declaration or a
   * `return`), not a condition, a loop, `break` or `continue`, and not a store dispatch
   * (`dispatch(addNotification(…))`), which only records what happened.
   */
  readonly reportable: boolean;
  /**
   * The variables it declares or assigns with data (`const plan = await getPlan(id)`,
   * `JSON.parse(text)`): a value that may not have the shape its type says.
   */
  readonly data: readonly string[];
  /** What its `await`s wait for, outside nested functions: each call up to its arguments. */
  readonly awaits: readonly Span[];
  /** The first thing it awaits, as written (`promise`), or null. */
  readonly awaited: string | null;
  /**
   * The bodies of the functions it only defines (`const save = async () => {…}`, a function
   * declaration): nothing in them runs at this line, so what they can throw is not its.
   */
  readonly defines: readonly Span[];
  /** The names it declares in the block. */
  readonly declares: readonly string[];
  /** Every name it mentions. */
  readonly uses: readonly string[];
};

type TryShape = {
  /** The `try` statement's start and end. */
  readonly at: Span;
  /** The `catch` tests the error or rethrows it: bugs already get through. */
  readonly passesBugsOn: boolean;
  /** The `catch` block ends with `return` or `throw`. */
  readonly catchExits: boolean;
  readonly hasFinally: boolean;
  /** The indentation of the `try` line, and of the lines inside its block. */
  readonly indent: string;
  readonly inner: string;
  readonly lines: readonly Line[];
  /** Names mentioned in the block around the `try`, outside it: a moved declaration must not clash. */
  readonly around: readonly string[];
};

export type NarrowTrySummary = {
  readonly throws: ThrowsSummary;
  readonly tries: readonly TryShape[];
};

/** The whitespace at the start of the line that holds `position`. */
function indentationAt(position: number, text: string): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, position))?.[0] ?? "";
}

/** Visits `root` without entering nested functions or classes. */
function running(root: ts.Node, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    if (node !== root && isFunctionBoundary(node)) return;
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}

/** Every identifier under `root`, nested functions included, except property names after a dot. */
function namesIn(root: ts.Node): string[] {
  const names = new Set<string>();
  const walk = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, walk);
  };
  walk(root);
  return [...names].sort();
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function declaredBy(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((one) => bindingNames(one.name));
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [statement.name.text];
  }
  return [];
}

/** The variable a chain of reads starts from: `plan` in `plan.details.title`. */
function rootOf(expression: ts.Expression): ts.Expression {
  let node = stripParentheses(expression);
  for (;;) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      node = stripParentheses(node.expression);
    } else if (ts.isCallExpression(node) || ts.isNonNullExpression(node)) {
      node = stripParentheses(node.expression);
    } else if (ts.isAwaitExpression(node) || ts.isAsExpression(node)) {
      node = stripParentheses(node.expression);
    } else {
      return node;
    }
  }
}

/** `dispatch(…)`, `store.dispatch(…)`, `await dispatch(…)`: a store dispatch. */
function isDispatch(expression: ts.Expression): boolean {
  const code = stripParentheses(expression);
  const call = ts.isAwaitExpression(code) ? stripParentheses(code.expression) : code;
  if (!ts.isCallExpression(call)) return false;
  const callee = stripParentheses(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  return ts.isIdentifier(name) && name.text === "dispatch";
}

/** See `Line.reportable`. */
function reportable(statement: ts.Statement): boolean {
  if (ts.isExpressionStatement(statement)) return !isDispatch(statement.expression);
  if (ts.isReturnStatement(statement)) {
    return statement.expression !== undefined && !isDispatch(statement.expression);
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.every(
      (one) => one.initializer === undefined || !isDispatch(one.initializer),
    );
  }
  return false;
}

/**
 * Whether `value` brings data from outside the program: it awaits (a response, a file, a message)
 * or parses JSON, or reads from a variable that holds such data. What a synchronous call returns
 * (`statSync(file)`, `new URL(…)`, a function of the project) has the shape its type says.
 */
function bringsData(value: ts.Expression, data: ReadonlySet<string>): boolean {
  // What `JSON.parse` gives has no checked shape either, but a wrong shape is the failure the
  // `catch` is there for, like bad JSON: reading it is not a bug-only line (real-world corpus).
  if (isJsonParse(unwrapped(value)) || isBodyJson(unwrapped(value))) return false;
  const root = rootOf(value);
  if (ts.isIdentifier(root) && data.has(root.text)) return true;
  return someRunning(value, (node) => ts.isAwaitExpression(node));
}

/** `JSON.parse(…)`. */
function isJsonParse(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = stripParentheses(node.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "parse" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "JSON"
  );
}

/**
 * `await response.json()`: a response body parsed as JSON, the same as `JSON.parse` (real-world corpus:
 * outline's API client reads the error body it parsed).
 */
function isBodyJson(node: ts.Expression): boolean {
  if (!ts.isAwaitExpression(node)) return false;
  const call = unwrapped(node.expression);
  if (!ts.isCallExpression(call) || call.arguments.length > 0) return false;
  const callee = stripParentheses(call.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "json";
}

/** The expression inside parentheses, `as`, `satisfies` and `!`. */
function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    } else return current;
  }
}

/** The names `statement` declares or assigns with data (`bringsData`); they are added to `data`. */
function dataOf(statement: ts.Statement, data: Set<string>): string[] {
  const assigned: { names: string[]; value: ts.Expression }[] = [];
  if (ts.isVariableStatement(statement)) {
    for (const one of statement.declarationList.declarations) {
      // Typed `unknown`, the value must be tested before any read: TypeScript already guards it.
      if (one.initializer !== undefined && one.type?.kind !== ts.SyntaxKind.UnknownKeyword) {
        assigned.push({ names: bindingNames(one.name), value: one.initializer });
      }
    }
  } else if (ts.isExpressionStatement(statement)) {
    const expression = stripParentheses(statement.expression);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expression.left)
    ) {
      assigned.push({ names: [expression.left.text], value: expression.right });
    }
  }
  const found: string[] = [];
  for (const { names, value } of assigned) {
    if (bringsData(value, data)) found.push(...names);
  }
  for (const name of found) data.add(name);
  return found;
}

/** Whether the catch tests what it caught, throws, or hands it to `reject(e)`: a bug gets through. */
function passesBugsOn(clause: ts.CatchClause): boolean {
  const throws = someRunning(
    clause.block,
    (node) =>
      ts.isThrowStatement(node) || (ts.isCallExpression(node) && handsOnCaught(node, clause)),
  );
  return throws || testsCaught(clause);
}

function endsWithExit(block: ts.Block): boolean {
  const last = block.statements.at(-1);
  return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

/** The calls whose rejection reaches `Promise.all([…])` and its kin. */
const COMBINED = new Set(["all", "race", "any"]);

/**
 * Where what an `await` waits for is written: a call up to its arguments (`api.save` in
 * `await api.save({ ttl: ttl.trim() })`, not `ttl.trim`, user trial 1.0.2), the promise a
 * `.then`/`.catch`/`.finally` chain starts from, and each call listed in `Promise.all([…])`;
 * nothing for `Promise.allSettled(…)`, which never rejects; any other value whole. A call inside the arguments runs before the request and is not it.
 */
function awaitedSpans(expression: ts.Expression, sourceFile: ts.SourceFile): Span[] {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  if (!ts.isCallExpression(node)) return [[node.getStart(sourceFile), node.getEnd()]];
  const callee = node.expression;
  const own: Span = [node.getStart(sourceFile), callee.getEnd()];
  if (!ts.isPropertyAccessExpression(callee)) return [own];
  const method = callee.name.text;
  if (method === "then" || method === "catch" || method === "finally") {
    return [own, ...awaitedSpans(callee.expression, sourceFile)];
  }
  const [list] = node.arguments;
  // `Promise.allSettled(…)` never rejects: an `await` of it waits for nothing that can fail.
  if (
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Promise" &&
    method === "allSettled"
  ) {
    return [];
  }
  if (
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Promise" &&
    COMBINED.has(method) &&
    list !== undefined &&
    ts.isArrayLiteralExpression(list)
  ) {
    return [own, ...list.elements.flatMap((element) => awaitedSpans(element, sourceFile))];
  }
  return [own];
}

/** The functions `statement` defines without running them, as spans (`Line.defines`). */
function definedFunctions(statement: ts.Statement, sourceFile: ts.SourceFile): Span[] {
  if (ts.isFunctionDeclaration(statement))
    return [[statement.getStart(sourceFile), statement.getEnd()]];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration): Span[] => {
    let value = declaration.initializer;
    while (value !== undefined && ts.isParenthesizedExpression(value)) value = value.expression;
    return value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
      ? [[value.getStart(sourceFile), value.getEnd()]]
      : [];
  });
}

function shapeOf(node: ts.TryStatement, sourceFile: ts.SourceFile): TryShape | undefined {
  const clause = node.catchClause;
  if (clause === undefined) return undefined;
  const text = sourceFile.text;
  const lines: Line[] = [];
  const data = new Set<string>();
  let previousEnd = node.tryBlock.getStart(sourceFile) + 1;
  for (const statement of node.tryBlock.statements) {
    const awaits: Span[] = [];
    let awaited: string | null = null;
    running(statement, (inner) => {
      if (ts.isAwaitExpression(inner)) {
        const spans = awaitedSpans(inner.expression, sourceFile);
        if (spans.length === 0) return;
        awaits.push(...spans);
        awaited ??= shorten(oneLine(inner.expression.getText(sourceFile)), LINE_MAX);
      }
    });
    lines.push({
      at: [statement.getStart(sourceFile), statement.getEnd()],
      text: oneLine(statement.getText(sourceFile)).replace(/;$/, ""),
      raw: text.slice(previousEnd, statement.getEnd()),
      reportable: reportable(statement),
      data: dataOf(statement, data),
      awaits,
      awaited,
      defines: definedFunctions(statement, sourceFile),
      declares: declaredBy(statement),
      uses: namesIn(statement),
    });
    previousEnd = statement.getEnd();
  }
  const parent = node.parent;
  const around =
    ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseOrDefaultClause(parent)
      ? parent.statements.filter((other) => other !== node).flatMap((other) => namesIn(other))
      : [];
  const first = node.tryBlock.statements[0];
  return {
    at: [node.getStart(sourceFile), node.getEnd()],
    passesBugsOn: passesBugsOn(clause),
    catchExits: endsWithExit(clause.block),
    hasFinally: node.finallyBlock !== undefined,
    indent: indentationAt(node.getStart(sourceFile), text),
    inner: first === undefined ? "" : indentationAt(first.getStart(sourceFile), text),
    lines,
    around: [...new Set(around)].sort(),
  };
}

function summarizeTries(ctx: FileContext): TryShape[] {
  const tries: TryShape[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node)) {
      const shape = shapeOf(node, ctx.sourceFile);
      if (shape !== undefined) tries.push(shape);
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return tries;
}

function readLine(value: Json): Line | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const awaits = each(f?.awaits, spanOf);
  const defines = each(f?.defines, spanOf);
  const declares = readStrings(f?.declares);
  const uses = readStrings(f?.uses);
  if (f === undefined || at === undefined || awaits === undefined || defines === undefined) {
    return undefined;
  }
  const data = readStrings(f.data);
  if (declares === undefined || uses === undefined || data === undefined) return undefined;
  const awaited = f.awaited === null ? null : isString(f.awaited) ? f.awaited : undefined;
  const { reportable: canReport } = f;
  return isString(f.text) &&
    isString(f.raw) &&
    awaited !== undefined &&
    typeof canReport === "boolean"
    ? {
        at,
        text: f.text,
        raw: f.raw,
        reportable: canReport,
        data,
        awaits,
        awaited,
        defines,
        declares,
        uses,
      }
    : undefined;
}

function readShape(value: Json): TryShape | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const lines = each(f?.lines, readLine);
  const around = readStrings(f?.around);
  if (f === undefined || at === undefined || lines === undefined || around === undefined) {
    return undefined;
  }
  const { passesBugsOn: passes, catchExits, hasFinally, indent, inner } = f;
  if (
    typeof passes !== "boolean" ||
    typeof catchExits !== "boolean" ||
    typeof hasFinally !== "boolean" ||
    !isString(indent) ||
    !isString(inner)
  ) {
    return undefined;
  }
  return { at, passesBugsOn: passes, catchExits, hasFinally, indent, inner, lines, around };
}

function readTries(value: Json): TryShape[] | undefined {
  return each(fieldsOf(value)?.tries, readShape);
}

// ---- deciding --------------------------------------------------------------------------------------

/** Something the analysis knows can be thrown or rejected at a place: what it is and what it adds. */
type Spot = {
  readonly at: Span;
  /** The spot of the `try` around it, when there is one: its own leaves are judged as that `try`. */
  readonly parent: Span | undefined;
  /** How the message names it: `getPlan(…)`. */
  readonly label: string;
  /** It adds a known class, a package's errors, or a rethrow. */
  readonly known: boolean;
  /**
   * It is known only because it calls a package whose errors are not all known (`toast.success`):
   * a request when awaited, not otherwise.
   */
  readonly packageOnly: boolean;
  /** It adds something stateward cannot follow. */
  readonly unknown: boolean;
  /** A call of a function of the project, or of a callback the function was given (`onClose()`). */
  readonly project: "function" | "callback" | null;
};

function labelOf(effect: Effect): string {
  switch (effect.k) {
    case "class":
      return effect.text ?? "throw";
    case "call":
    case "package":
    case "unknown":
    case "maybe":
      return `${effect.text}(…)`;
    case "rethrow":
      return "throw";
    case "try":
      return "try";
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

/** Every effect of the file, each judged on its own, with the `try` it sits in. */
function spotsOf(analysis: Analysis, file: string, effects: readonly Effect[], out: Spot[]): void {
  const context = {
    file,
    classes: analysis.classes,
    resultOf: (id: string) => analysis.results.get(id),
  };
  const visit = (list: readonly Effect[], parent: Span | undefined): void => {
    for (const effect of list) {
      if (effect.k === "rethrow") {
        out.push({
          at: effect.at,
          parent,
          label: "throw",
          known: true,
          packageOnly: false,
          unknown: false,
          project: null,
        });
        continue;
      }
      const into = collected();
      evaluate([effect], context, new Map(), into);
      const fromPackage = [...into.unknowns.values()].some((one) => one.package !== undefined);
      out.push({
        at: effect.at,
        parent,
        label: labelOf(effect),
        known: into.classes.size > 0 || fromPackage,
        packageOnly: into.classes.size === 0 && fromPackage,
        unknown: into.unknowns.size > 0 || into.more,
        project:
          effect.k === "call"
            ? "function"
            : effect.k === "unknown" && effect.reason === REASON.callback
              ? "callback"
              : null,
      });
      if (effect.k === "try") {
        visit(effect.body, effect.at);
        if (effect.handler !== null) {
          const { handler } = effect;
          visit(handler.pre, effect.at);
          for (const branch of handler.branches) visit(branch.body, effect.at);
          if (handler.otherwise !== null) visit(handler.otherwise, effect.at);
          visit(handler.after, effect.at);
        }
        visit(effect.fin, effect.at);
      }
    }
  };
  visit(effects, undefined);
}

const within = (inner: Span, outer: Span): boolean => inner[0] >= outer[0] && inner[1] <= outer[1];

/** The spots of `line` that are its own: not inside a `try` that is itself inside the line. */
function spotsIn(line: Line, spots: readonly Spot[]): Spot[] {
  return spots.filter(
    (spot) =>
      within(spot.at, line.at) &&
      (spot.parent === undefined || !within(spot.parent, line.at)) &&
      !line.defines.some((body) => within(spot.at, body)),
  );
}

/**
 * What can fail as expected in `line`: a spot with a known error, or one stateward cannot follow
 * that the line awaits (a rejection not known to be nothing). The last one, by position.
 */
function expectedIn(line: Line, spots: readonly Spot[]): Spot | undefined {
  const awaited = (spot: Spot): boolean => line.awaits.some((span) => within(spot.at, span));
  // A call of a package that is not awaited (`toast.success(…)`) is not the request the `try` is for.
  const found = spotsIn(line, spots).filter((spot) =>
    spot.packageOnly ? awaited(spot) : spot.known || (spot.unknown && awaited(spot)),
  );
  // By where it ends: `JSON.parse(readFileSync(…))` is named, not the call inside it.
  found.sort((a, b) => a.at[1] - b.at[1] || b.at[0] - a.at[0]);
  const last = found.at(-1);
  if (last !== undefined) return last;
  // An `await` of a value the analysis has no leaf for at all (`await promise`): a rejection.
  return line.awaits.length > 0 && spotsIn(line, spots).length === 0
    ? {
        at: line.at,
        parent: undefined,
        label: line.awaited ?? "await",
        known: false,
        packageOnly: false,
        unknown: true,
        project: null,
      }
    : undefined;
}

/** A line with nothing known to fail as expected in it. */
function bugOnly(line: Line, spots: readonly Spot[]): boolean {
  return (
    line.awaits.length === 0 &&
    spotsIn(line, spots).every((spot) => !spot.known || spot.packageOnly)
  );
}

/** The move of `moved` after the `try`, one level less indented; undefined when it is not safe. */
function moveFix(shape: TryShape, kept: readonly Line[], moved: readonly Line[], file: string) {
  if (!shape.catchExits || shape.hasFinally || shape.inner === "") return undefined;
  const keptNames = new Set(kept.flatMap((line) => line.declares));
  if (moved.some((line) => line.uses.some((name) => keptNames.has(name)))) return undefined;
  const movedNames = moved.flatMap((line) => line.declares);
  if (movedNames.some((name) => shape.around.includes(name))) return undefined;
  const lastKept = kept.at(-1);
  const lastMoved = moved.at(-1);
  if (lastKept === undefined || lastMoved === undefined) return undefined;
  const raw = moved.map((line) => line.raw).join("");
  const dedented = raw.split(`\n${shape.inner}`).join(`\n${shape.indent}`);
  const fix: Fix = {
    title: moved.length === 1 ? "Move the line after the `try`" : "Move the lines after the `try`",
    edits: [
      { location: { file, start: lastKept.at[1], end: lastMoved.at[1] }, newText: "" },
      { location: { file, start: shape.at[1], end: shape.at[1] }, newText: dedented },
    ],
  };
  return fix;
}

/** A line as code in a message: cut before a backtick of its own, which would end the code span. */
function asCode(text: string): string {
  const tick = text.indexOf("`");
  const shown = shorten(text, LINE_MAX);
  return tick < 0 || tick >= shown.length ? shown : `${text.slice(0, tick).trimEnd()} …`;
}

/**
 * How the message names what the `try` is for. A `throw` names the thrown expression with its
 * arguments cut (`throw new AccessError(…)`), not the keyword alone.
 */
function nameOf(spot: Spot, line: Line | undefined): string {
  if (spot.label !== "throw" || line === undefined) return spot.label;
  const thrown = /\bthrow\s+(.+)$/.exec(line.text)?.[1];
  if (thrown === undefined) return spot.label;
  const open = thrown.indexOf("(");
  return `throw ${open < 0 ? thrown : `${thrown.slice(0, open)}(…)`}`;
}

function headline(line: string, expected: string): string {
  return fitted(
    (cut) =>
      `the \`try\` for \`${cut(expected)}\` also catches errors from \`${asCode(cut(line))}\``,
  );
}

function hint(expected: string, fixable: boolean, count: number): string {
  const [lines, them] = count === 1 ? ["the line", "it"] : ["the lines", "them"];
  const why = `so a bug in ${them} is not handled like a failed \`${expected}\``;
  if (fixable) return `move ${lines} after the \`try\`, ${why} (quick fix)`;
  return `move ${lines} after the \`try\` and return from the \`catch\` (declare what ${count === 1 ? "it uses" : "they use"} before the \`try\`), ${why}`;
}

/** A promise's own `resolve` and `reject` (excalidraw): they never throw. */
const SETTLES = new Set(["resolve(…)", "reject(…)"]);

function checkTry(
  shape: TryShape,
  spots: readonly Spot[],
  file: string,
  report: (problem: { message: string; hint: string; at: Span; fixes: readonly Fix[] }) => void,
): void {
  if (shape.passesBugsOn) return;
  let lastExpected = -1;
  let expected: Spot | undefined;
  for (const [index, line] of shape.lines.entries()) {
    const found = expectedIn(line, spots);
    if (found !== undefined) {
      lastExpected = index;
      expected = found;
    }
  }
  if (expected === undefined) return;
  const target = nameOf(expected, shape.lines[lastExpected]);
  const kept = shape.lines.slice(0, lastExpected + 1);
  const moved = shape.lines.slice(lastExpected + 1);
  if (!moved.every((line) => bugOnly(line, spots))) return;
  // A line is reported when it hands the data the `try` got to a function of the project, or
  // calls a callback it was given (`onClose()`): code whose bugs the `catch` would hide. Plain
  // reads, conditions, defaults (`?? []`) and store dispatches are left alone: on a large app (111 warnings) nearly all of those were noise.
  const data = new Set(shape.lines.flatMap((line) => line.data));
  const usesData = (line: Line): boolean => line.uses.some((name) => data.has(name));
  const first = moved.find(
    (line) =>
      line.reportable &&
      spotsIn(line, spots).some(
        (spot) =>
          (spot.project === "callback" && !SETTLES.has(spot.label)) ||
          (spot.project === "function" && usesData(line)),
      ),
  );
  if (first === undefined) return;
  const fix = moveFix(shape, kept, moved, file);
  report({
    message: headline(first.text, target),
    hint: hint(target, fix !== undefined, moved.length),
    at: first.at,
    fixes: fix === undefined ? [] : [fix],
  });
}

export const narrowTry = defineRule({
  kind: "project",
  meta: {
    description:
      "A bug in code inside a `try` meant for another call is caught and reported as that call's failure; moving the code after the `try` keeps the two apart.",
    summary:
      "calls to your own code inside a `try` after the call it is for, so their bugs look like its failure",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "narrow-try",
    group: GROUP,
    needsJsDoc: true,
    explain: EXPLAIN,
  },
  summarize: (ctx): NarrowTrySummary => ({
    throws: summarizeOnce(ctx),
    tries: summarizeTries(ctx),
  }),
  check(summaries, ctx) {
    const analysis = analyse(throwsOf(summaries));
    const spotsByFile = new Map<string, Spot[]>();
    const spotsFor = (file: string): Spot[] => {
      const known = spotsByFile.get(file);
      if (known !== undefined) return known;
      const spots: Spot[] = [];
      for (const entry of analysis.functions.values()) {
        if (entry.file !== file) continue;
        spotsOf(analysis, file, entry.fact.body, spots);
        spotsOf(analysis, file, entry.fact.returns, spots);
      }
      for (const module of analysis.modules) {
        if (module.file === file) spotsOf(analysis, file, module.effects, spots);
      }
      spotsByFile.set(file, spots);
      return spots;
    };
    for (const file of [...summaries.keys()].sort()) {
      const value = summaries.get(file);
      const tries = value === undefined ? undefined : readTries(value);
      if (tries === undefined || tries.length === 0) continue;
      const spots = spotsFor(file);
      for (const shape of tries) {
        checkTry(shape, spots, file, (problem) => {
          ctx.report({
            message: problem.message,
            hint: problem.hint,
            location: { file, start: problem.at[0], end: problem.at[1] },
            fixes: problem.fixes,
          });
        });
      }
    }
  },
});
