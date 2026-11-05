import ts from "@stateward/core/typescript";
import type { Resolver } from "./resolve.js";
import type { FunctionLike } from "./syntax.js";
import { ANY_CONTEXT, type Placement, type SlotRef } from "./summary.js";

/**
 * What a child route adds to the placement of what it renders: it renders at the `outlet` slot of
 * its parent route (`via`), or, when stateward does not follow routes, nowhere it can check.
 */
export type NestedRoute = { kind: "outlet"; slot: SlotRef } | { kind: "unchecked" };

/** Reads React Router's route nesting from the nodes above a node. */
export type RouteLookup = { nestedIn(child: ts.Node, parent: ts.Node): NestedRoute | undefined };

/**
 * The Providers and slots around `node`, read from the JSX above it up to `stop` (the component
 * function, or the argument of an entry call). A Provider counts for what is between its tags, not
 * for its own attributes; an own component's tags give the slot the node is passed into.
 */
export function placementOf(
  node: ts.Node,
  stop: ts.Node,
  resolver: Resolver,
  fn: FunctionLike | undefined,
  routes?: RouteLookup,
): Placement {
  const under: string[] = [];
  const via: Placement["via"] = [];

  const addOwner = (opening: ts.JsxOpeningLikeElement, slot: string): void => {
    const tag = resolver.resolveTag(opening.tagName, fn);
    if (tag.kind === "provider" && slot === "children") under.push(tag.context);
    if (tag.kind === "component") via.push({ owner: tag.id, name: slot });
  };

  let child = node;
  while (child !== stop && !ts.isSourceFile(child)) {
    const parent = child.parent;
    if (ts.isJsxElement(parent) && parent.children.some((member) => member === child)) {
      addOwner(parent.openingElement, "children");
    } else if (ts.isJsxAttribute(parent) && ts.isJsxAttributes(parent.parent)) {
      const opening = parent.parent.parent;
      const name = ts.isIdentifier(parent.name) ? parent.name.text : parent.name.getText();
      if (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) {
        addOwner(opening, name);
      }
    }
    const nested = routes?.nestedIn(child, parent);
    if (nested?.kind === "outlet") via.push(nested.slot);
    if (nested?.kind === "unchecked") under.push(ANY_CONTEXT);
    child = parent;
  }
  return { under, via };
}
