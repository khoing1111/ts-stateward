import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext, type OptionsOf } from "@stateward/core";
import { fitted, withExample } from "./text.js";
import { handsOnCaught, someRunning, stripParentheses, testsCaught } from "./syntax.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "catch";

const EXPLAIN = `# errors/catch-without-intent

Experimental: on real projects it is mostly wrong; it may change or be removed.

A catch that handles every error says how: it narrows, reports, or falls back; one that only logs, or calls something stateward cannot judge, and carries on is reported.

## Why

In \`load\`, a failed \`fetchUser\` is logged and \`render(user)\` runs anyway, with a \`user\` that was never fetched. The page shows a blank profile instead of an error, and the only trace is a line in the console.

A \`catch\` that takes every error should be one of four kinds:

- **narrowing**: it tests the error (\`e instanceof NotFoundError\`, \`isApiError(e)\`, \`e.name === "AbortError"\`) and rethrows the rest; \`errors/catch-hides-unexpected\` checks that part;
- **edge**: it reports the error where it ends: through Sentry (\`Sentry.captureException(e)\`, \`captureMessage\`), Bugsnag (\`Bugsnag.notify(e)\`) or Datadog (\`datadogRum.addError(e)\`), which stateward knows; through one of your helpers (\`reportAndShow(e)\`), declared in \`edgeHelpers\`; or by telling the user: a store dispatch of an action named for it (\`dispatch(addNotification(…))\`, \`showToast\`, \`setError\`, \`showAlert\`), or a state setter given the error or a failure (\`setError(e)\`, \`setState("failed")\`);
- **fallback**: the code has a real default: assigned before the \`try\`, returned after the \`catch\`, or assigned or returned in the \`catch\`;
- **passed on**: it throws, or hands the error to a callback of the function around it (\`reject(e)\`, \`next(e)\`).

Anything else is reported.

## When to use it

It stays experimental until it is mostly right on real projects. Use it for code that must never lose a failure: payments, sync, data import; or to review a module's catches once. Declare your own reporters in \`edgeHelpers\` first. In most apps many catches that only log are deliberate fallbacks (a setting read from storage, a best-effort cache write), so it is off until you add its add-on (below), and no preset or \`init\` turns it on; then a warning in every preset. To be strict in one folder only, use \`overrides\`: on for \`src/payments/**\`, off elsewhere.

## What it catches

A \`catch\` that only logs (\`console.*\`, a call on \`logger\` or \`log\`, or \`.error\`, \`.warn\`, \`.info\`, \`.debug\` on any object), or calls a function of your own that is not declared as a helper, when the function carries on after the \`try\`. A function of your own counts only once it is declared: \`edgeHelpers\` for one that reports, \`swallowHelpers\` for one that ignores an error on purpose (\`ignoreError(e)\`). Until then the message asks which it is.

### Bad

\`\`\`ts
async function load(id: string) {
  let user;
  try {
    user = await fetchUser(id);
  } catch (e) {
    console.error(e);
  }
  return render(user);
}
\`\`\`

### Good

\`\`\`ts
async function load(id: string) {
  try {
    return render(await fetchUser(id));
  } catch (e) {
    reportAndShow(e); // listed in edgeHelpers
    return renderError();
  }
}
\`\`\`

### Fix

The message names the better form for the shape of the code:

- the \`try\` assigns a variable declared with no value (\`let user;\`): give it a fallback first;
- the \`try\` returns a value and the \`catch\` returns nothing: return the default from the \`catch\`;
- the file already calls one of your \`edgeHelpers\`: report it like the rest of the file (\`reportAndShow(e);\`);
- the \`catch\` is in an async event handler (\`onClick={async () => …}\`, \`handleSubmit\`): show it to the user, since nothing above the handler will;
- otherwise: rethrow it, or \`return err(e);\` when the file imports a function named \`err\`.

When the \`catch\` calls a function of yours, the message first asks: if it reports the error, add it to \`edgeHelpers\`. There is no quick fix.

## What it does not catch

It stays quiet when:

- the \`catch\` throws, returns, assigns, tests the error, reports it (Sentry, Bugsnag, Datadog, a declared helper), tells the user (a dispatch of a notification, toast, error or alert action; a state setter given the error or a failure), hands the error to a callback parameter (\`reject(e)\`), or keeps it in a collection (\`errors.push(String(e))\`);
- the \`catch\` is empty: ESLint's \`no-empty\` (in \`eslint:recommended\`) and Biome's \`noEmptyBlockStatements\` already report an empty block, and accept one with a comment, as this rule did;
- the \`try\` returns its value and the code after it returns a default (\`try { return JSON.parse(stored); } catch (e) { console.warn(e); } return defaults;\`);
- every variable the \`try\` assigns already had a value to fall back on (\`let flags = DEFAULTS; try { flags = JSON.parse(stored); } catch …\`; a parameter counts, a \`let\` with no value does not);
- the \`try\` is the last thing the function, or a loop's body, does (a retry loop moves on to the next attempt).

Other tools: ESLint's \`no-useless-catch\` and Biome's \`noUselessCatch\` report a \`catch\` that only rethrows; eslint-plugin-unicorn's \`prefer-optional-catch-binding\` and \`catch-error-name\`, and typescript-eslint's \`use-unknown-in-catch-callback-variable\`, are about the catch variable. None of them looks at what a \`catch\` does with the error, so this rule does not repeat them.

## Turn it on or off

Turn it on in \`stateward.config.ts\`:

\`\`\`ts
addons: ["errors/catch-intent"]
\`\`\`

Then declare your helpers, change the rule, or set it per folder:

\`\`\`ts
rules: { "errors/catch-without-intent": ["warning", { edgeHelpers: ["reportAndShow", "Sentry.captureException"], swallowHelpers: ["ignoreError"] }] }
rules: { "errors/catch-without-intent": ["warning", { logFunctions: ["logError"] }] } // your own log helpers
overrides: [{ files: ["src/payments/**"], rules: { "errors/catch-without-intent": "error" } }]
rules: { "errors/catch-without-intent": "off" } // or "error"
groups: { "errors/catch": "off" } // the whole group
\`\`\`
`;

const OPTIONS = {
  loggers: option.strings({
    default: ["console", "logger", "log"],
    description:
      "Objects whose every method only logs (globs like *Logger): a catch that only calls them swallows the error.",
  }),
  logMethods: option.strings({
    default: ["error", "warn", "info", "debug"],
    description:
      "Method names that only log, on any object (`Sentry.captureException` is not one).",
  }),
  logFunctions: option.strings({
    default: [],
    description: "Plain functions of your own that only log, like logError (globs allowed).",
  }),
  edgeHelpers: option.strings({
    default: [],
    description:
      "Your functions that report an error where it ends (to a service, to the user): a catch that calls one is handled, like reportAndShow (globs allowed). Sentry, Bugsnag and Datadog are known without it.",
  }),
  swallowHelpers: option.strings({
    default: [],
    description:
      "Functions that mark an error as ignored on purpose, like ignoreError (globs allowed): a catch that calls one is not reported.",
  }),
};

type Logging = OptionsOf<typeof OPTIONS>;

/** The name an expression ends in: `logger`, `this.logger`, `app.log`. */
function lastName(expression: ts.Expression): string | undefined {
  const node = stripParentheses(expression);
  if (ts.isIdentifier(node)) return node.text;
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

/**
 * A call that only logs: any method of a logger (`console.x()`, `logger.x()`), a log method on any
 * object (`app.warn()`), or one of the team's own log functions (`logError(e)`).
 */
function isLoggingCall(expression: ts.Expression, logging: Logging): boolean {
  const call = stripParentheses(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = stripParentheses(call.expression);
  if (ts.isIdentifier(callee)) return matchesName(callee.text, logging.logFunctions);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (logging.logMethods.includes(callee.name.text)) return true;
  const name = lastName(stripParentheses(callee.expression));
  return name !== undefined && matchesName(name, logging.loggers);
}

/** `reportAndShow`, `Sentry.captureException`, `this.reporter.send`: how a call is matched to a name list. */
function calleeText(call: ts.CallExpression): string | undefined {
  const parts: string[] = [];
  let node = stripParentheses(call.expression);
  for (;;) {
    if (ts.isIdentifier(node)) {
      parts.unshift(node.text);
      return parts.join(".");
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      parts.unshift("this");
      return parts.join(".");
    }
    if (!ts.isPropertyAccessExpression(node) || ts.isPrivateIdentifier(node.name)) return undefined;
    parts.unshift(node.name.text);
    node = stripParentheses(node.expression);
  }
}

function callsOneOf(call: ts.CallExpression, names: readonly string[]): boolean {
  const text = calleeText(call);
  return text !== undefined && matchesName(text, names);
}

function stripAwait(expression: ts.Expression): ts.Expression {
  const inner = stripParentheses(expression);
  return ts.isAwaitExpression(inner) ? stripParentheses(inner.expression) : inner;
}

/**
 * Error reporters every project means the same thing by: Sentry, Bugsnag and
 * Datadog RUM. A catch that calls one reports the error where it ends, as a declared edge helper
 * does. `console.error` is not one: it is only seen by whoever has the console open.
 */
const KNOWN_REPORTERS = [
  "Sentry.captureException",
  "Sentry.captureMessage",
  "captureException",
  "captureMessage",
  "*.captureException",
  "*.captureMessage",
  "Bugsnag.notify",
  "bugsnagClient.notify",
  "datadogRum.addError",
  "DD_RUM.addError",
];

/** The last name of what a call calls: `dispatch` in `store.dispatch(…)`, `addNotification`. */
function calledName(call: ts.CallExpression): string | undefined {
  return lastName(stripParentheses(call.expression));
}

/** An action that shows the user something: `addNotification(…)`, `showToast(…)`, `{ type: "alerts/show" }`. */
const TELLS_USER = /notif|toast|error|alert/i;

/**
 * A store dispatch of an action that tells the user (`dispatch(addNotification(…))`): the failure
 * reaches the user through the store, like a toast.
 */
function tellsTheUser(call: ts.CallExpression): boolean {
  if (calledName(call) !== "dispatch") return false;
  const [action] = call.arguments;
  if (action === undefined) return false;
  return isUserAction(action);
}

/** An action that tells the user; a `?:` counts when every branch does (`cond ? addNotification(…) : serverError(e)`). */
function isUserAction(action: ts.Expression): boolean {
  const code = stripParentheses(action);
  if (ts.isConditionalExpression(code)) {
    return isUserAction(code.whenTrue) && isUserAction(code.whenFalse);
  }
  if (ts.isCallExpression(code)) return TELLS_USER.test(calledName(code) ?? "");
  if (!ts.isObjectLiteralExpression(code)) return false;
  return code.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "type" &&
      ts.isStringLiteralLike(property.initializer) &&
      TELLS_USER.test(property.initializer.text),
  );
}

const SETTER = /^set[A-Z]/;
const FAILURE_WORD = /error|fail/i;

/**
 * A state setter given an error-like value: `setError(e)`, `setState("failed")`,
 * `this.setState({ error: e.message })`. The component then shows the failure.
 */
function setsFailureState(call: ts.CallExpression, clause: ts.CatchClause): boolean {
  const name = calledName(call);
  if (name === undefined || !SETTER.test(name)) return false;
  if (FAILURE_WORD.test(name)) return true;
  const declaration = clause.variableDeclaration;
  const variable =
    declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : "";
  const errorLike = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === variable) ||
    (ts.isStringLiteralLike(node) && FAILURE_WORD.test(node.text)) ||
    ts.forEachChild(node, (child) => (errorLike(child) ? true : undefined)) === true;
  return call.arguments.some(errorLike);
}

/** Methods that keep what they are given in a collection: `errors.push(…)`, `failed.set(id, …)`. */
const COLLECTING = new Set(["push", "unshift", "set", "add"]);

/**
 * Whether `call` keeps the caught error, or a message made from it, in a collection
 * (`errorMessages.push(\`\${url} failed: \${e}\`)`): the code after the loop reads it, like a
 * fallback.
 */
function collectsCaught(call: ts.CallExpression, clause: ts.CatchClause): boolean {
  const declaration = clause.variableDeclaration;
  if (declaration === undefined || !ts.isIdentifier(declaration.name)) return false;
  const variable = declaration.name.text;
  const callee = stripParentheses(call.expression);
  if (!ts.isPropertyAccessExpression(callee) || !COLLECTING.has(callee.name.text)) return false;
  const mentions = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === variable) ||
    ts.forEachChild(node, (child) => (mentions(child) ? true : undefined)) === true;
  return call.arguments.some(mentions);
}

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/**
 * What the catch does with every error it gets. `handled` when it is one of these kinds: it tests the error (narrowing), throws, returns or assigns (a fallback),
 * calls a declared edge or swallow helper, or hands the error to a callback of the function around
 * it (`reject(e)`, `next(e)`); an empty catch is left to ESLint's `no-empty`. Otherwise `logs`
 * when it only logs, or `other` with the first call that is not logging (`showToast`), which may
 * or may not report it.
 */
type Shape = { kind: "handled" } | { kind: "logs" } | { kind: "other"; call: string | undefined };

function shapeOf(clause: ts.CatchClause, logging: Logging): Shape {
  const statements = clause.block.statements.filter((statement) => !ts.isEmptyStatement(statement));
  if (statements.length === 0 || testsCaught(clause)) return { kind: "handled" };
  const declared = [...logging.edgeHelpers, ...logging.swallowHelpers];
  const handled = someRunning(clause.block, (node) => {
    if (ts.isThrowStatement(node) || ts.isReturnStatement(node)) return true;
    if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) return true;
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return true;
    }
    return (
      ts.isCallExpression(node) &&
      (callsOneOf(node, declared) ||
        callsOneOf(node, KNOWN_REPORTERS) ||
        tellsTheUser(node) ||
        setsFailureState(node, clause) ||
        handsOnCaught(node, clause) ||
        collectsCaught(node, clause))
    );
  });
  if (handled) return { kind: "handled" };
  const onlyLogs = statements.every(
    (statement) =>
      ts.isExpressionStatement(statement) && isLoggingCall(statement.expression, logging),
  );
  if (onlyLogs) return { kind: "logs" };
  // The first statement that is a call, not logging: what the message asks about.
  const first = statements
    .map((statement) =>
      ts.isExpressionStatement(statement) ? stripAwait(statement.expression) : undefined,
    )
    .find(
      (expression): expression is ts.CallExpression =>
        expression !== undefined &&
        ts.isCallExpression(expression) &&
        !isLoggingCall(expression, logging),
    );
  return { kind: "other", call: first === undefined ? undefined : calleeText(first) };
}

/** Statements that run nothing: a bare `;` and declarations that only exist at compile time. */
function runsNothing(statement: ts.Statement): boolean {
  return (
    ts.isEmptyStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  );
}

/** `return;`, `break;` and `continue;` end the flow: nothing after them carries on. */
function endsFlow(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return statement.expression === undefined;
  return ts.isBreakStatement(statement) || ts.isContinueStatement(statement);
}

/**
 * Whether the function runs something after the `try` statement: a statement that follows it in
 * its block or in a block around it, up to the function (or the file, for top-level code). The end
 * of a loop's body runs nothing after it: the loop goes on to its next turn (a retry loop's next
 * attempt).
 */
function continuesAfter(tryStatement: ts.TryStatement): boolean {
  let node: ts.Node = tryStatement;
  for (let parent = node.parent; ; parent = node.parent) {
    if (ts.isFunctionLike(parent)) return false;
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseOrDefaultClause(parent)) {
      const statements = parent.statements;
      const after = statements.slice(statements.findIndex((candidate) => candidate === node) + 1);
      const next = after.find((statement) => !runsNothing(statement));
      if (next !== undefined) return !endsFlow(next);
    }
    if (ts.isSourceFile(parent)) return false;
    if (ts.isIterationStatement(parent, false) && parent.statement === node) return false;
    node = parent;
  }
}

/** Whether `node` has a `return` with a value that runs in this function (not in a nested one). */
function returnsValue(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return node.expression !== undefined;
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
  return ts.forEachChild(node, (child) => (returnsValue(child) ? true : undefined)) === true;
}

/**
 * A fallback: the `try` returns the value it produced, and the statement right after it returns
 * another one (`try { return JSON.parse(stored); } catch (e) { console.warn(e); } return
 * defaults;`). The caller gets a value either way; nothing runs on a result that was never made.
 */
function fallsBackToAValue(tryStatement: ts.TryStatement): boolean {
  const list = tryStatement.parent;
  if (!ts.isBlock(list) && !ts.isSourceFile(list) && !ts.isCaseOrDefaultClause(list)) return false;
  const after = list.statements.slice(list.statements.indexOf(tryStatement) + 1);
  const next = after.find((statement) => !runsNothing(statement));
  return (
    next !== undefined &&
    ts.isReturnStatement(next) &&
    next.expression !== undefined &&
    returnsValue(tryStatement.tryBlock)
  );
}

/** The names the `try` block assigns with `=` (not in a nested function): `flags = parse(…)`. */
function assignedNames(block: ts.Block): readonly string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(stripParentheses(node.left))
    ) {
      const target = stripParentheses(node.left);
      if (ts.isIdentifier(target)) names.push(target.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(block);
  return names;
}

/**
 * How `name` is declared before the `try`: a `let` or `var` with a value (`value`) or without one
 * (`empty`), in a block around it (before it, up to the module), or a parameter of a function
 * around it (`value`: it holds the caller's value). Undefined when it is declared elsewhere.
 */
function declaredBefore(
  name: string,
  tryStatement: ts.TryStatement,
): "value" | "empty" | undefined {
  let node: ts.Node = tryStatement;
  for (let parent = node.parent; ; parent = node.parent) {
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseOrDefaultClause(parent)) {
      const before = parent.statements.slice(
        0,
        parent.statements.findIndex((s) => s === node),
      );
      for (const statement of before) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            return declaration.initializer === undefined ? "empty" : "value";
          }
        }
      }
    }
    // A parameter holds the caller's value; past it, a closure's or the module's variable.
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
      )
    ) {
      return "value";
    }
    if (ts.isSourceFile(parent)) return undefined;
    node = parent;
  }
}

/**
 * A fallback assigned before the `try`: every variable the `try` assigns already held a value
 * (`let flags = DEFAULTS; try { flags = parse(…); } catch (e) { log(e); } return flags;`). The
 * code after the `try` runs on that value when the `try` fails, which is what the author chose.
 */
function replacesAFallback(tryStatement: ts.TryStatement): boolean {
  const names = assignedNames(tryStatement.tryBlock);
  return names.length > 0 && names.every((name) => declaredBefore(name, tryStatement) === "value");
}

function headline(shape: Exclude<Shape, { kind: "handled" }>): string {
  if (shape.kind === "logs") return "this catch logs the error and carries on as if nothing failed";
  if (shape.call === undefined) {
    return "this catch neither reports the error nor gives a fallback, and the code carries on";
  }
  return fitted(
    (cut) =>
      `this catch calls \`${cut(shape.call ?? "")}\` and carries on; stateward cannot tell whether that reports the error`,
  );
}

/** The local name of a function `err` the file imports (the project's Result helper, neverthrow's). */
function importedErr(sourceFile: ts.SourceFile): string | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const element = bindings.elements.find(
      (candidate) =>
        !candidate.isTypeOnly && (candidate.propertyName ?? candidate.name).text === "err",
    );
    if (element !== undefined) return element.name.text;
  }
  return undefined;
}

/** A variable the `try` assigns that was declared with no value: `let user;`. */
function unsetVariable(tryStatement: ts.TryStatement): string | undefined {
  return assignedNames(tryStatement.tryBlock).find(
    (name) => declaredBefore(name, tryStatement) === "empty",
  );
}

/** The first call in the file of a declared edge helper, as written: `reportAndShow`. */
function edgeHelperOfFile(sourceFile: ts.SourceFile, edgeHelpers: readonly string[]) {
  if (edgeHelpers.length === 0) return undefined;
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && callsOneOf(node, edgeHelpers)) found = calleeText(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const HANDLER_NAME = /^(handle|on)[A-Z]/;

/**
 * Whether the catch runs in an async event handler: an `async` function passed to an `on…` JSX
 * attribute or `addEventListener`, or named `handle…` / `on…`. Its caller is the browser, so a
 * failure only reaches the user if the handler shows it.
 */
function inAsyncEventHandler(clause: ts.CatchClause): boolean {
  let fn: ts.Node = clause;
  while (!ts.isSourceFile(fn) && !ts.isFunctionLike(fn)) fn = fn.parent;
  if (!ts.isFunctionLike(fn) || !hasAsync(fn)) return false;
  const named =
    (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name !== undefined
      ? fn.name.getText()
      : undefined;
  if (named !== undefined) return HANDLER_NAME.test(named);
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return HANDLER_NAME.test(parent.name.getText());
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
    return HANDLER_NAME.test(parent.parent.name.getText());
  }
  if (ts.isCallExpression(parent)) {
    const callee = calleeText(parent);
    return (
      callee !== undefined &&
      (callee === "addEventListener" || callee.endsWith(".addEventListener"))
    );
  }
  return false;
}

function hasAsync(fn: ts.SignatureDeclaration): boolean {
  return (
    ts.canHaveModifiers(fn) &&
    ts.getModifiers(fn)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
  );
}

/**
 * The better form for this catch's shape: a fallback for a variable left unset, a default
 * for a function that returns one, the file's own way to report, the user for an event handler;
 * else a rethrow, or the file's `err`.
 */
function advice(
  clause: ts.CatchClause,
  variable: string,
  ctx: FileContext<Logging>,
): { line: string; example: readonly string[] } {
  const tryStatement = clause.parent;
  const unset = unsetVariable(tryStatement);
  if (unset !== undefined) {
    return {
      line: `give \`${unset}\` a fallback before the \`try\`: \`let ${unset} = …;\``,
      example: [],
    };
  }
  if (returnsValue(tryStatement.tryBlock)) {
    return {
      line: "return the default from the `catch`",
      example: [],
    };
  }
  const edge = edgeHelperOfFile(ctx.sourceFile, [...ctx.options.edgeHelpers, ...KNOWN_REPORTERS]);
  if (edge !== undefined) {
    return { line: "report it like the rest of this file:", example: [`${edge}(${variable});`] };
  }
  if (inAsyncEventHandler(clause)) {
    return {
      line: "show it to the user: no caller of an event handler will",
      example: [],
    };
  }
  const err = importedErr(ctx.sourceFile);
  return {
    line: "rethrow it, return a failure the caller can see, or show it to the user:",
    example: [err === undefined ? `throw ${variable};` : `return ${err}(${variable});`],
  };
}

function hint(
  shape: Exclude<Shape, { kind: "handled" }>,
  clause: ts.CatchClause,
  variable: string,
  ctx: FileContext<Logging>,
): string {
  const { line, example } = advice(clause, variable, ctx);
  if (shape.kind === "other" && shape.call !== undefined) {
    return withExample(
      `if \`${shape.call}\` reports it, add it to \`edgeHelpers\`; if not, ${line}`,
      example,
    );
  }
  return withExample(line, example);
}

function checkCatch(clause: ts.CatchClause, ctx: FileContext<Logging>): void {
  const shape = shapeOf(clause, ctx.options);
  if (
    shape.kind === "handled" ||
    !continuesAfter(clause.parent) ||
    fallsBackToAValue(clause.parent) ||
    replacesAFallback(clause.parent)
  ) {
    return;
  }
  const declaration = clause.variableDeclaration;
  const variable =
    declaration !== undefined && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : "error";
  ctx.report({
    node: clause.getFirstToken(ctx.sourceFile) ?? clause,
    message: headline(shape),
    hint: hint(shape, clause, variable, ctx),
  });
}

export const catchWithoutIntent = defineRule({
  kind: "file",
  meta: {
    description:
      "Experimental: on real projects it is mostly wrong; it may change or be removed. A catch that handles every error says how: it narrows, reports, or falls back; one that only logs, or calls something stateward cannot judge, and carries on is reported.",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "catch-intent",
    group: GROUP,
    heuristic: true,
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCatchClause(node)) checkCatch(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
