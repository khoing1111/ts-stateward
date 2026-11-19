import ts from "@stateward/core/typescript";
import type { FileContext, LedgerRef, ReadOutcome } from "@stateward/core";
import {
  functionOf,
  isUseReducer,
  namesOf,
  signatureOf,
  startsOf,
  summarizeFile,
  useOf,
} from "./summary.js";
import { shorten } from "./text.js";

/**
 * The references of `@initial` and `@final` the reference ledger lists in one file, marked for
 * the rule that proves each: `reducers/reducer-not-readable` (`@initial`: every start of the
 * reducer is in a state it lists) and `reducers/state-cannot-leave` (`@final`: no reducer leaves a
 * state it lists).
 */

const INITIAL = "@initial";
const FINAL = "@final";

/** The longest code a reason quotes. */
const CODE_MAX = 40;

function text(node: ts.Node): string {
  return shorten(node.getText().replace(/\s+/g, " "), CODE_MAX);
}

/** The identifiers, private names and string keys of a file, by where they start. */
function nodesOf(sourceFile: ts.SourceFile): Map<number, ts.Node> {
  const nodes = new Map<number, ts.Node>();
  const index = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) {
      nodes.set(node.getStart(sourceFile), node);
    }
    ts.forEachChild(node, index);
  };
  index(sourceFile);
  return nodes;
}

/** The declarations of a file a tag is on, by where the tag starts. */
function taggedBy(sourceFile: ts.SourceFile, tagName: string): Map<number, ts.Node> {
  const found = new Map<number, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node)
    ) {
      const tag = ts.getJSDocTags(node).find((one) => one.tagName.text === tagName);
      if (tag !== undefined) found.set(tag.getStart(sourceFile), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The expression a reference is the value of: through `(…)`, `!`, `as` and `satisfies`. */
function outermost(node: ts.Node): ts.Node {
  let at = node;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isNonNullExpression(at.parent) ||
    ts.isAsExpression(at.parent) ||
    ts.isSatisfiesExpression(at.parent)
  ) {
    at = at.parent;
  }
  return at;
}

const NOT_A_REDUCER = (name: string): ReadOutcome => ({
  kind: "unchecked",
  reason: `\`${name}\` is not read as a reducer, because its state is not a union of objects told apart by one property: make each state an object with one literal property in common, as \`{ color: "red" } | { color: "green" }\``,
});

/** Marks the file's references of reducers tagged `@initial`. */
export function markInitialReferences(ctx: FileContext): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === INITIAL);
  if (refs.length === 0) return;
  const { sourceFile, types } = ctx;
  const tagged = taggedBy(sourceFile, "initial");
  const nodes = nodesOf(sourceFile);
  for (const ref of refs) {
    if (ref.form === "tag") {
      const declaration = tagged.get(ref.location.start);
      const found = declaration === undefined ? undefined : functionOf(declaration);
      const sig = found === undefined ? undefined : signatureOf(found, types);
      ctx.read(ref, sig === undefined ? NOT_A_REDUCER(ref.name) : { kind: "decided" });
      continue;
    }
    const node = nodes.get(ref.location.start);
    ctx.read(ref, node === undefined ? notFound(ref) : initialOutcome(ref, node, ctx));
  }
}

function notFound(ref: LedgerRef): ReadOutcome {
  return {
    kind: "unchecked",
    reason: `\`${ref.text}\` is not found in the file again: check again, and report it to stateward's authors if it stays`,
  };
}

function initialOutcome(ref: LedgerRef, node: ts.Node, ctx: FileContext): ReadOutcome {
  const { types } = ctx;
  if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
    return { kind: "irrelevant" };
  }
  const value = outermost(node);
  const call = value.parent;
  if (ref.form === "argument" && ts.isCallExpression(call)) {
    if (!isUseReducer(call, types) || call.arguments[0] !== value) {
      return {
        kind: "unchecked",
        reason: `\`${text(call)}\` gives the reducer to a function other than \`useReducer\`, so where it starts is not checked: start it with \`useReducer(reducer, start)\``,
      };
    }
    const use = useOf(call, ctx);
    if (use === undefined) return NOT_A_REDUCER(ref.name);
    if (use.starts === null) {
      return {
        kind: "unchecked",
        reason: `\`${text(call)}\` starts the reducer in a state that is not known: start it with an object literal, or a \`const\` typed with the state type, not cast to it`,
      };
    }
    // The project side reports a start `@initial` does not list.
    return { kind: "decided" };
  }
  if (ref.form === "call" && ts.isCallExpression(call) && call.expression === value) {
    const symbol = types.symbolAt(node);
    const declared = symbol === undefined ? undefined : types.declarationOf(symbol);
    const found = declared === undefined ? undefined : functionOf(declared.node);
    const sig = found === undefined ? undefined : signatureOf(found, types);
    const [state] = call.arguments;
    if (sig === undefined) return NOT_A_REDUCER(ref.name);
    const initial = namesOf(sig.host, "initial", sig.host.getSourceFile());
    const starts = state === undefined ? null : startsOf(state, sig, types);
    if (starts === null || initial === null || starts.empty.length > 0) {
      return {
        kind: "unchecked",
        reason: `\`${text(call)}\` calls the reducer directly, in a state that is not known: pass an object literal, or a \`const\` typed with the state type`,
      };
    }
    const unlisted = starts.tags.filter((tag) => !initial.names.includes(tag));
    return unlisted.length === 0
      ? { kind: "decided" }
      : {
          kind: "unchecked",
          reason: `\`${text(call)}\` calls the reducer directly in ${unlisted.map((tag) => JSON.stringify(tag)).join(", ")}, which \`@initial\` does not list: add ${unlisted.length === 1 ? "it" : "them"} to \`@initial\`, or call it in a state \`@initial\` lists`,
        };
  }
  if (ref.form === "alias") {
    return {
      kind: "unchecked",
      reason: `\`${ref.text}\` gives the reducer another name, and stateward does not check where it starts under that name: use the reducer by its own name`,
    };
  }
  return {
    kind: "unchecked",
    reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read for \`@initial\`: give the reducer to \`useReducer\` directly`,
  };
}

/** Marks the file's references of state types tagged `@final`. */
export function markFinalReferences(ctx: FileContext): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === FINAL);
  if (refs.length === 0) return;
  const { sourceFile, types } = ctx;
  const nodes = nodesOf(sourceFile);
  const summary = summarizeFile(ctx);
  for (const ref of refs) {
    // The tag's names are checked against the type on the project side.
    if (ref.form === "tag" || ref.form === "import" || ref.form === "export") {
      ctx.read(ref, ref.form === "tag" ? { kind: "decided" } : { kind: "irrelevant" });
      continue;
    }
    const node = nodes.get(ref.location.start);
    if (node === undefined) {
      ctx.read(ref, notFound(ref));
      continue;
    }
    if (ref.form !== "type") {
      ctx.read(ref, {
        kind: "unchecked",
        reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read for \`@final\`: use the type only to type a reducer's state and what it returns`,
      });
      continue;
    }
    // A name of the type in a function's parameters or return: a reducer over it is read.
    const fn = ts.findAncestor(node, (at) => ts.isFunctionLike(at) || ts.isBlock(at));
    if (
      fn === undefined ||
      ts.isBlock(fn) ||
      !ts.isFunctionLike(fn) ||
      !("body" in fn) ||
      fn.body === undefined
    ) {
      ctx.read(ref, { kind: "irrelevant" });
      continue;
    }
    const returnsState = fn.type !== undefined && contains(fn.type, node);
    const owner =
      ts.isFunctionDeclaration(fn) && fn.name !== undefined
        ? fn
        : ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)
          ? fn.parent
          : undefined;
    const found = owner === undefined ? undefined : functionOf(owner);
    const sig = found === undefined ? undefined : signatureOf(found, types);
    if (sig === undefined) {
      ctx.read(
        ref,
        returnsState
          ? {
              kind: "unchecked",
              reason: `a function that returns \`${ref.name}\` is not read as a reducer: write it as \`(state, action)\` with a \`switch\` on the action`,
            }
          : { kind: "irrelevant" },
      );
      continue;
    }
    const reducer = summary?.reducers.find((one) => one.at.start === sig.name.getStart());
    if (reducer === undefined) {
      ctx.read(ref, NOT_A_REDUCER(sig.name.text));
      continue;
    }
    const finals = reducer.final?.names ?? [];
    const [unread] = reducer.unreadable;
    const blind = reducer.edges.find(
      (edge) => !edge.read && edge.to.some((tag) => !finals.includes(tag)),
    );
    if (unread !== undefined) {
      ctx.read(ref, {
        kind: "unchecked",
        reason: `\`${unread.text}\` in \`${reducer.name}\` returns a state that is not known: return an object literal, or the \`state\` it was given`,
      });
    } else if (blind !== undefined) {
      ctx.read(ref, {
        kind: "unchecked",
        reason: `\`${shorten(sourceFile.text.slice(blind.start, blind.end).replace(/\s+/g, " "), CODE_MAX)}\` in \`${reducer.name}\` returns a state, but which state it leaves from is not known: test \`state\` itself before the \`return\` (\`if (state.status === …)\` or a \`switch\`), not a copy of its property`,
      });
    } else {
      // Every way out is read: the project side reports one that leaves a final state.
      ctx.read(ref, { kind: "decided" });
    }
  }
}

function contains(outer: ts.Node, inner: ts.Node): boolean {
  return inner.getStart() >= outer.getStart() && inner.end <= outer.end;
}
