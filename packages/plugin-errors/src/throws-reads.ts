import ts from "@stateward/core/typescript";
import type { FileContext, LedgerRef, ReadOutcome } from "@stateward/core";

/**
 * The references of `@throws` the reference ledger lists in one file, marked for
 * `errors/throws-doc-mismatch`: the tag on a function it reads is decided (the project side
 * reports what the function can throw against it); a tag it cannot check is not checked, with
 * why; a call, an alias, an argument or an import only uses what the function's body proves.
 */

/** The trait a `@throws` tag states in the reference ledger. */
const TRAIT = "@throws";

/** The function a declaration holds, written in place. */
function heldFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (!(ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node))) return undefined;
  let value = node.initializer;
  while (value !== undefined && ts.isParenthesizedExpression(value)) value = value.expression;
  return value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
    ? value
    : undefined;
}

/** A declaration a tag can be on, as the reference ledger lists it. */
function isTaggable(
  node: ts.Node,
): node is
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.MethodSignature
  | ts.VariableDeclaration
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.TypeAliasDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}

function nameOf(node: ts.Node): string {
  return isTaggable(node) && node.name !== undefined ? node.name.getText() : "it";
}

/** What the tag on a declaration leaves to read: decided when the project side reads it all. */
function tagOutcome(node: ts.Node, tags: readonly ts.JSDocTag[]): ReadOutcome {
  const name = nameOf(node);
  const fn =
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ? node : heldFunction(node);
  if (fn === undefined) {
    return ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)
      ? {
          kind: "unchecked",
          reason: `\`${name}\` holds a value that is not a function written here: assign it an arrow function, written in place`,
        }
      : {
          kind: "unchecked",
          reason: `\`${name}\` has no body to read: put the tag on a function written with its body`,
        };
  }
  if (fn.asteriskToken !== undefined) {
    return {
      kind: "unchecked",
      reason: `\`${name}\` is a generator, and stateward does not check what it throws while it is iterated: tag a plain function instead, and call it from the generator`,
    };
  }
  if (fn.body === undefined) {
    return {
      kind: "unchecked",
      reason: `\`${name}\` has no body to read: put the tag on a function written with its body`,
    };
  }
  const typed = tags.some((tag) => ts.isJSDocThrowsTag(tag) && tag.typeExpression !== undefined);
  return typed
    ? { kind: "decided" }
    : {
        kind: "unchecked",
        reason: `\`@throws\` of \`${name}\` names no class, so what it states cannot be checked: name the class in braces, as \`@throws {ParseError}\``,
      };
}

export function markThrowsReferences(ctx: FileContext): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === TRAIT);
  if (refs.length === 0) return;
  const { sourceFile } = ctx;
  const tagged = new Map<number, ReadOutcome>();
  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!isTaggable(node)) return;
    const held = heldFunction(node);
    const tags = [
      ...ts.getJSDocTags(node),
      ...(held === undefined ? [] : ts.getJSDocTags(held)),
    ].filter((tag) => tag.tagName.text === "throws");
    const [first] = tags;
    if (first !== undefined) tagged.set(first.getStart(sourceFile), tagOutcome(node, tags));
  };
  visit(sourceFile);
  for (const ref of refs) ctx.read(ref, outcomeOf(ref, tagged));
}

function outcomeOf(ref: LedgerRef, tagged: ReadonlyMap<number, ReadOutcome>): ReadOutcome {
  if (ref.form === "tag") {
    return (
      tagged.get(ref.location.start) ?? {
        kind: "unchecked",
        reason: `\`${ref.text}\` is on a declaration that is not read for the tag: put it on a function, or on a \`const\` that holds an arrow function`,
      }
    );
  }
  // Giving the name another function changes what it throws: not read.
  if (ref.form === "write") {
    return {
      kind: "unchecked",
      reason: `\`${ref.text}\` (a write) is a use of \`${ref.name}\` that stateward does not read for \`@throws\`: give the name one function, where it is declared`,
    };
  }
  return { kind: "irrelevant" };
}
