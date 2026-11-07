import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  enclosingFunction,
  isFunctionNode,
  setterCall,
  type Effect,
} from "./effects.js";

/** The promise methods whose callback runs when the answer arrives. */
export const LATE_CALLBACKS: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

/** The `.then(…)` call a node is an argument of, or inside an argument of. */
export function lateCallback(node: ts.Node, effect: Effect): ts.CallExpression | undefined {
  for (let current = node; current !== effect.callback; current = current.parent) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.some((argument) => argument === current) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      LATE_CALLBACKS.has(parent.expression.name.text)
    ) {
      return parent;
    }
  }
  return undefined;
}

/** The `await`s in the same function before a node, not inside another function, in order. */
export function awaitsBefore(node: ts.Node): readonly ts.AwaitExpression[] {
  const fn = enclosingFunction(node);
  if (fn === undefined) return [];
  const found: ts.AwaitExpression[] = [];
  const visit = (current: ts.Node): void => {
    if (current.pos >= node.pos) return;
    if (ts.isAwaitExpression(current) && current.end <= node.pos) found.push(current);
    if (!isFunctionNode(current)) ts.forEachChild(current, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/** The `await`s inside a node (`setUser(await load())`), not inside another function. */
function awaitsIn(node: ts.Node): readonly ts.AwaitExpression[] {
  const found: ts.AwaitExpression[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isAwaitExpression(current)) found.push(current);
    if (!isFunctionNode(current)) ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** The call a `.then` chain starts from: `fetchUser(id)` in `fetchUser(id).then(…).then(…)`. */
export function chainRoot(call: ts.CallExpression): ts.Expression {
  let current: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
    const next: ts.Expression = current.expression;
    if (
      ts.isCallExpression(current) &&
      !(
        ts.isPropertyAccessExpression(current.expression) &&
        LATE_CALLBACKS.has(current.expression.name.text)
      )
    ) {
      return current;
    }
    current = next;
  }
  return current;
}

/**
 * A state set from a response: the write, the setter it calls, and what it waits for (the root of
 * the `.then` chain it is in, or the `await`s before it in its function). `waitsFor` is empty for
 * a write that waits for nothing.
 */
export type StateWrite = {
  readonly node: ts.Node;
  readonly setter: string;
  /** The root of the `.then` chain the write is a callback of. */
  readonly then: ts.Expression | undefined;
  /** The awaited expressions before the write in its function. */
  readonly awaited: readonly ts.Expression[];
};

/** A `setX(…)` call, or a setter passed as a callback (`.then(setUser)`), and what it waits for. */
export function stateWrite(
  types: TypeQueries,
  node: ts.Node,
  effect: Effect,
): StateWrite | undefined {
  const set = setterCall(types, node);
  const passed =
    ts.isIdentifier(node) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments.some((argument) => argument === node) &&
    bindingOf(types, node)?.part === "setter"
      ? node.text
      : undefined;
  const setter = set !== undefined ? set.binding.setter : passed;
  if (setter === undefined) return undefined;
  const then = lateCallback(node, effect);
  return {
    node,
    setter,
    then: then === undefined ? undefined : chainRoot(then),
    awaited: [...awaitsBefore(node), ...awaitsIn(node)].map((awaited) => awaited.expression),
  };
}

/** Every state write written in an effect (its nested functions included), in source order. */
export function stateWrites(types: TypeQueries, effect: Effect): readonly StateWrite[] {
  const writes: StateWrite[] = [];
  const visit = (node: ts.Node): void => {
    const write = stateWrite(types, node, effect);
    if (write !== undefined) writes.push(write);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(effect.callback, visit);
  return writes;
}

/** Whether `inner` is `outer` or inside it. */
export function contains(outer: ts.Node, inner: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}
