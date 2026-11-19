import ts from "@stateward/core/typescript";
import { neverRejectsFactOf, type FileContext } from "@stateward/core";
import {
  functionOfDeclaration,
  isFunctionBoundary,
  pathOf,
  scanRunning,
  stripParentheses,
  type DeclaredFunction,
} from "./syntax.js";

/** How many `const` names for a function are followed to it (`const p = post`). */
const ALIAS_DEPTH = 3;

/**
 * Packages whose requests reject when they fail (a network error, or an error status), without
 * facts in the config: what a team means by "the request failed".
 */
const REJECTING_PACKAGES: ReadonlySet<string> = new Set([
  "axios",
  "ky",
  "ofetch",
  "got",
  "node-fetch",
  "superagent",
]);

/** The JSDoc tag a project writes on a function, a prop or a function type that never rejects. */
export const NEVER_REJECTS = "neverRejects";

/**
 * A `throw` that cannot run: it, or a plain statement before it in its block, uses a value
 * TypeScript types `never` (`const unexpected: never = command; throw new Error(…)` in an exhaustive
 * `switch`'s `default`).
 */
export function cannotRun(statement: ts.ThrowStatement, ctx: FileContext): boolean {
  const parent = statement.parent;
  const block =
    ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)
      ? parent.statements
      : [statement];
  // Only the `throw` and the plain statements just before it in the same block: an exhaustive
  // check in an earlier branch says nothing about a later `throw`.
  const upTo = block
    .slice(0, block.indexOf(statement))
    .filter((each) => ts.isVariableStatement(each) || ts.isExpressionStatement(each));
  let never = false;
  const visit = (node: ts.Node): void => {
    if (never || ts.isFunctionLike(node)) return;
    if (ts.isIdentifier(node) && ctx.types.typeTextOf(node) === "never") {
      never = true;
      return;
    }
    // A branch that may not run says nothing about the `throw`: `x === "a" ? "A" : x`, `a && x`.
    if (ts.isConditionalExpression(node)) {
      visit(node.condition);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
    ) {
      visit(node.left);
      return;
    }
    ts.forEachChild(node, visit);
  };
  [...upTo, statement].forEach(visit);
  return never;
}

/**
 * Whether awaiting `expression` can reject, as far as this file can tell: `fetch` and the
 * packages above do; a project function does when something it runs throws or awaits a call that
 * rejects, outside a `try` that catches; the config's `facts` say so for a package function. A
 * promise that settles with its error in the value (`unwrap`, RTK Query) does not, nor does a call
 * the project tags `@neverRejects`. Anything else
 * (a package with no facts, a function received as a value or a prop) is not known: false.
 */
export type CanReject = (expression: ts.Expression) => boolean;

/** `CanReject` that also says whether a call throws at once (`throwsCall`), for a function that must not throw. */
export type Rejections = CanReject & { readonly throwsCall: (call: ts.CallExpression) => boolean };

/** `JSON.parse(…)`: the platform's call that throws on bad input; the project's functions are read, a package's is not. */
export function isJsonParse(call: ts.CallExpression): boolean {
  const callee = stripParentheses(call.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "JSON" &&
    callee.name.text === "parse"
  );
}

/**
 * `unknownRejects`: what this file cannot tell (a package with no facts, a function received as a
 * value, a promise held in a variable, a project function deeper than it follows) counts as able
 * to reject. The pending rule asks the default (false); `async/handler-rejection-lost` asks with
 * true, so it follows the project's own functions and still reports what it cannot see into.
 */
export function rejectionsOf(
  ctx: FileContext,
  options: { readonly unknownRejects?: boolean } = {},
): Rejections {
  const unknown = options.unknownRejects === true;
  const memo = new Map<ts.Node, boolean>();
  // A function being read when it is reached again (recursion): what it does is not known yet, so
  // the answer does not depend on which function was read first.
  const reading = new Set<ts.Node>();
  // Answers found during the current outermost question, some of them on a guess: a function
  // reached again by another path keeps its answer instead of being read again (a depth-first
  // search). Whether a failure can be reached does not depend on the path taken to it.
  const readThisTime = new Map<ts.Node, boolean>();
  // An answer given without reading (a recursion) depends on where the reading started: a body
  // whose answer used one is not remembered, so every caller gets the same answer whatever was
  // read first. Every other body is read once, however deep, and remembered.
  let guesses = 0;

  const bodyRejects = (body: ts.Node): boolean => {
    const known = memo.get(body) ?? readThisTime.get(body);
    if (known !== undefined) return known;
    if (reading.has(body)) {
      guesses += 1;
      return unknown;
    }
    const before = guesses;
    const outermost = reading.size === 0;
    reading.add(body);
    const scanned = (): boolean => {
      let rejects = false;
      scanRunning(body, (node, guarded) => {
        if (rejects || guarded) return;
        if (ts.isThrowStatement(node)) rejects = !cannotRun(node, ctx);
        else if (ts.isAwaitExpression(node)) rejects = expressionRejects(node.expression);
        // `for await (const line of lines)`: the iterator's promises are not followed.
        else if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) rejects = unknown;
        else if (ts.isReturnStatement(node) && node.expression !== undefined) {
          rejects = expressionRejects(node.expression);
        }
        // `parse(x)` with no `await`: a synchronous function of the project that throws makes
        // this one fail too (an `async` function rejects with it).
        else if (ts.isCallExpression(node) && throwsSync(node)) rejects = true;
      });
      return rejects;
    };
    // `(x) => api.post(x)`: an arrow's expression body is what it returns.
    const found =
      scanned() || (!ts.isBlock(body) && ts.isExpression(body) && expressionRejects(body));
    reading.delete(body);
    if (guesses === before) memo.set(body, found);
    else readThisTime.set(body, found);
    if (outermost) {
      // As for `throwsSync`: when the first question ends "cannot reject", nothing it read can.
      if (!found) for (const each of readThisTime.keys()) memo.set(each, false);
      readThisTime.clear();
    }
    return found;
  };

  const throwing = new Map<ts.Node, boolean>();
  const throwingNow = new Set<ts.Node>();
  // As `readThisTime`, for `throwsSync`.
  const throwsThisTime = new Map<ts.Node, boolean>();
  let throwGuesses = 0;
  /**
   * Whether a call to a synchronous function of the project can throw: its body has a `throw`
   * that can run outside a `try` with a `catch`, or calls such a function. A package or lib
   * function (`JSON.parse`) is not followed; an `async` function rejects instead of throwing.
   */
  const throwsSync = (call: ts.CallExpression): boolean => {
    const callee = stripParentheses(call.expression);
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return false;
    const fn = functionOfDeclaration(declared.node);
    if (fn?.body === undefined || !ts.isBlock(fn.body)) return false;
    if (fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword))
      return false;
    if (fn.asteriskToken !== undefined) return false;
    const body = fn.body;
    const known = throwing.get(body) ?? throwsThisTime.get(body);
    if (known !== undefined) return known;
    // A recursive call adds nothing; an answer that relied on that guess is not remembered, so it
    // does not depend on which function was read first.
    if (throwingNow.has(body)) {
      throwGuesses += 1;
      return false;
    }
    const before = throwGuesses;
    const outermost = throwingNow.size === 0;
    throwingNow.add(body);
    const scanned = (): boolean => {
      let found = false;
      scanRunning(body, (node, guarded) => {
        if (found || guarded) return;
        if (ts.isThrowStatement(node)) found = !cannotRun(node, ctx);
        else if (ts.isCallExpression(node)) found = throwsSync(node);
      });
      return found;
    };
    const throws = scanned();
    throwingNow.delete(body);
    if (throwGuesses === before) throwing.set(body, throws);
    else throwsThisTime.set(body, throws);
    if (outermost) {
      // Nothing visited can throw when the first question ends "no": a throw anywhere would have
      // made it "yes". Remembering them all keeps dense recursion from being read again and again.
      if (!throws) for (const each of throwsThisTime.keys()) throwing.set(each, false);
      throwsThisTime.clear();
    }
    return throws;
  };

  /**
   * Whether a callback given to `.then`, `.catch` or `.finally` can make the chain reject: it
   * throws or returns a promise that can. A function written in place is read; one passed by name
   * is not followed.
   */
  const callbackRejects = (callback: ts.Expression | undefined): boolean => {
    if (callback === undefined) return false;
    const fn = stripParentheses(callback);
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return unknown;
    return bodyRejects(fn.body);
  };

  const packageRejects = (call: ts.CallExpression, declared: { file: string; node: ts.Node }) => {
    // The global `fetch`, declared by TypeScript's own lib or Node's types.
    if (ts.isIdentifier(call.expression) && call.expression.text === "fetch") return true;
    const packageName = ctx.types.packageOf(declared.file);
    // TypeScript's own lib: `response.json()` rejects, `Promise.resolve(x)` does not; not told apart.
    if (packageName === undefined) return unknown;
    const facts = ctx.facts[packageName];
    const names = pathOf(declared.node);
    const entry = facts?.[names.join(".")] ?? facts?.[names.at(-1) ?? ""];
    // An entry that says nothing about failures (only `returns`) does not say it cannot fail.
    if (entry !== undefined && (entry.rejects !== undefined || entry.throws !== undefined)) {
      return (entry.rejects ?? []).length > 0 || (entry.throws ?? []).length > 0;
    }
    return REJECTING_PACKAGES.has(packageName) || unknown;
  };

  const callRejects = (call: ts.CallExpression): boolean => {
    if (ctx.types.settlesWithError(call)) return false;
    // The facts say so: `neverRejects: true` for the package function.
    if (neverRejectsFactOf(call, ctx) !== undefined) return false;
    // The project says so: `/** @neverRejects */` on the function, the prop or its function type.
    if (ctx.types.calleeTags(call).includes(NEVER_REJECTS)) return false;
    const callee = stripParentheses(call.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      // `Promise.reject(…)` always rejects.
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Promise" &&
        method === "reject"
      ) {
        return true;
      }
      // `Promise.allSettled(…)` settles with every outcome in its value.
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Promise" &&
        method === "allSettled"
      ) {
        return false;
      }
      // `Promise.all([a(), b()])` rejects when one of them does.
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Promise" &&
        ["all", "race", "any"].includes(method)
      ) {
        const [list] = call.arguments;
        // `Promise.any` rejects when every promise does, so always for none.
        if (list === undefined) return method === "any";
        // A list built elsewhere (`Promise.all(receipts)`): its promises are not followed.
        if (!ts.isArrayLiteralExpression(list)) return unknown;
        if (method === "any") {
          return list.elements.every((element) => expressionRejects(element));
        }
        return list.elements.some((element) => expressionRejects(element));
      }
      // `p.catch(handle)` handles `p`'s failure, unless `handle` throws or rejects itself.
      const [first, second] = call.arguments;
      if (method === "catch" && first !== undefined) return callbackRejects(first);
      // `p.then(use, handle)`: `handle` takes `p`'s failure; `use` can still fail.
      if (method === "then" && second !== undefined) {
        return callbackRejects(first) || callbackRejects(second);
      }
      // `p.then(use)` and `p.finally(done)` keep `p`'s failure, and add their callback's.
      if (method === "then" || method === "finally") {
        return expressionRejects(callee.expression) || callbackRejects(first);
      }
    }
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declared === undefined) return unknown;
    if (!ctx.types.isOwnFile(declared.file)) {
      // `post.call(null)`, `post.apply(null, [])`: the function itself runs.
      const target =
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === "call" || callee.name.text === "apply")
          ? ownFunctionOf(callee.expression)
          : undefined;
      if (target !== undefined) {
        return target === "unknown" || target.body === undefined
          ? unknown
          : bodyRejects(target.body);
      }
      return packageRejects(call, declared);
    }
    const fn = followedFunction(declared.node, 0);
    if (fn?.body === undefined) return unknown;
    return bodyRejects(fn.body);
  };

  /**
   * The function a declaration holds: a function, a method, one bound to a name, or another `const`
   * name for one (`const p = post`), followed a few times.
   */
  const followedFunction = (node: ts.Node, depth: number): DeclaredFunction | undefined => {
    const fn = functionOfDeclaration(node);
    if (fn !== undefined || depth >= ALIAS_DEPTH) return fn;
    if (
      !ts.isVariableDeclaration(node) ||
      node.initializer === undefined ||
      !ts.isVariableDeclarationList(node.parent) ||
      (node.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return undefined;
    }
    const value = stripParentheses(node.initializer);
    const name = ts.isPropertyAccessExpression(value) ? value.name : value;
    if (!ts.isIdentifier(name)) return undefined;
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    return declared === undefined || !ctx.types.isOwnFile(declared.file)
      ? undefined
      : followedFunction(declared.node, depth + 1);
  };

  /** The project's function an expression names (`post`, `api.save`); "unknown" when it names another. */
  const ownFunctionOf = (expression: ts.Expression): DeclaredFunction | "unknown" | undefined => {
    const target = stripParentheses(expression);
    const name = ts.isPropertyAccessExpression(target) ? target.name : target;
    if (!ts.isIdentifier(name)) return "unknown";
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return "unknown";
    return followedFunction(declared.node, 0) ?? "unknown";
  };

  /** `Promise` as the platform declares it, not a name of the project. */
  const isPlatformPromise = (expression: ts.Expression): boolean => {
    if (!ts.isIdentifier(expression) || expression.text !== "Promise") return false;
    const symbol = ctx.types.symbolAt(expression);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    return declared !== undefined && !ctx.types.isOwnFile(declared.file);
  };

  /**
   * Whether `new Promise(executor)` can reject: the executor calls its `reject`, or throws while it
   * runs (a `throw`, `JSON.parse(…)`, a function of the project that throws). An executor passed
   * by name, or a `reject` handed on to other code, is not followed.
   */
  const executorRejects = (executor: ts.Expression | undefined): boolean => {
    if (executor === undefined) return false;
    const fn = stripParentheses(executor);
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return unknown;
    const reject = fn.parameters[1];
    const rejectId =
      reject !== undefined && ts.isIdentifier(reject.name)
        ? ctx.types.symbolAt(reject.name)?.id
        : undefined;
    // Set from the walks below: `reject` called while the executor runs, or handed on.
    const found = { certain: false, handedOn: false };
    const uses = (node: ts.Node, nested: boolean): void => {
      if (
        rejectId !== undefined &&
        ts.isIdentifier(node) &&
        node !== reject?.name &&
        ctx.types.symbolAt(node)?.id === rejectId
      ) {
        const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (called && !nested) found.certain = true;
        else found.handedOn = true;
      }
      ts.forEachChild(node, (child) => {
        uses(child, nested || (child !== fn.body && isFunctionBoundary(child)));
      });
    };
    uses(fn.body, false);
    scanRunning(fn.body, (node, guarded) => {
      if (found.certain || guarded) return;
      if (ts.isThrowStatement(node)) found.certain = !cannotRun(node, ctx);
      else if (ts.isCallExpression(node) && (isJsonParse(node) || throwsSync(node))) {
        found.certain = true;
      }
    });
    return found.certain || (found.handedOn && unknown);
  };

  const expressionRejects = (expression: ts.Expression): boolean => {
    const inner = stripParentheses(expression);
    if (ts.isAwaitExpression(inner)) return expressionRejects(inner.expression);
    if (ts.isCallExpression(inner)) return callRejects(inner);
    if (ts.isNewExpression(inner) && isPlatformPromise(inner.expression)) {
      return executorRejects(inner.arguments?.[0]);
    }
    // `await (query ? a() : b())`, `await (cached ?? load())`: either side can be what is awaited.
    if (ts.isConditionalExpression(inner)) {
      return expressionRejects(inner.whenTrue) || expressionRejects(inner.whenFalse);
    }
    if (
      ts.isBinaryExpression(inner) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(inner.operatorToken.kind)
    ) {
      return expressionRejects(inner.left) || expressionRejects(inner.right);
    }
    // A promise held in a name or a property, or a value whose type does not resolve: where it
    // comes from is not followed.
    return (
      unknown &&
      (ctx.types.isPromiseLike(inner) ||
        ctx.types.isErrorType(inner) ||
        ["any", "unknown"].includes(ctx.types.typeTextOf(inner)))
    );
  };

  return Object.assign((expression: ts.Expression) => expressionRejects(expression), {
    throwsCall: throwsSync,
  });
}
