import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";
import { functionOfDeclaration, pathOf, scanRunning, stripParentheses } from "./syntax.js";

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

/** How deep a project function is followed into the functions it awaits. */
const MAX_DEPTH = 4;

/**
 * Whether awaiting `expression` can reject, as far as this file can tell: `fetch` and the
 * packages above do; a project function does when something it runs throws or awaits a call that
 * rejects, outside a `try` that catches; the config's `facts` say so for a package function. A
 * promise that settles with its error in the value (`unwrap`, RTK Query) does not, nor does a call
 * the project tags `@neverRejects`. Anything else
 * (a package with no facts, a function received as a value or a prop) is not known: false.
 */
export type CanReject = (expression: ts.Expression) => boolean;

export function rejectionsOf(ctx: FileContext): CanReject {
  const memo = new Map<ts.Node, boolean>();

  const bodyRejects = (body: ts.Node, depth: number): boolean => {
    const known = memo.get(body);
    if (known !== undefined) return known;
    // While it is being followed, a recursive call adds nothing.
    memo.set(body, false);
    let found = false;
    scanRunning(body, (node, guarded) => {
      if (found || guarded) return;
      if (ts.isThrowStatement(node)) found = true;
      else if (ts.isAwaitExpression(node)) found = expressionRejects(node.expression, depth);
      else if (ts.isReturnStatement(node) && node.expression !== undefined) {
        found = expressionRejects(node.expression, depth);
      }
    });
    memo.set(body, found);
    return found;
  };

  const packageRejects = (call: ts.CallExpression, declared: { file: string; node: ts.Node }) => {
    // The global `fetch`, declared by TypeScript's own lib or Node's types.
    if (ts.isIdentifier(call.expression) && call.expression.text === "fetch") return true;
    const packageName = ctx.types.packageOf(declared.file);
    if (packageName === undefined) return false;
    const facts = ctx.facts[packageName];
    const names = pathOf(declared.node);
    const entry = facts?.[names.join(".")] ?? facts?.[names.at(-1) ?? ""];
    if (entry !== undefined) {
      return (entry.rejects ?? []).length > 0 || (entry.throws ?? []).length > 0;
    }
    return REJECTING_PACKAGES.has(packageName);
  };

  const callRejects = (call: ts.CallExpression, depth: number): boolean => {
    if (ctx.types.settlesWithError(call)) return false;
    // The project says so: `/** @neverRejects */` on the function, the prop or its function type.
    if (ctx.types.calleeTags(call).includes(NEVER_REJECTS)) return false;
    const callee = stripParentheses(call.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      // `Promise.all([a(), b()])` rejects when one of them does.
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Promise" &&
        ["all", "race", "any"].includes(method)
      ) {
        const [list] = call.arguments;
        return (
          list !== undefined &&
          ts.isArrayLiteralExpression(list) &&
          list.elements.some((element) => expressionRejects(element, depth))
        );
      }
      // `p.catch(handle)` handles its own failure; `p.then(…)` / `p.finally(…)` keep `p`'s.
      if (method === "catch" && call.arguments.length > 0) return false;
      if (method === "then" && call.arguments.length > 1) return false;
      if (method === "then" || method === "finally") {
        return expressionRejects(callee.expression, depth);
      }
    }
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declared === undefined) return false;
    if (!ctx.types.isOwnFile(declared.file)) return packageRejects(call, declared);
    const fn = functionOfDeclaration(declared.node);
    if (fn?.body === undefined || depth >= MAX_DEPTH) return false;
    return bodyRejects(fn.body, depth + 1);
  };

  const expressionRejects = (expression: ts.Expression, depth: number): boolean => {
    const inner = stripParentheses(expression);
    if (ts.isAwaitExpression(inner)) return expressionRejects(inner.expression, depth);
    if (ts.isCallExpression(inner)) return callRejects(inner, depth);
    return false;
  };

  return (expression) => expressionRejects(expression, 0);
}
