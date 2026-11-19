import ts from "@stateward/core/typescript";
import { isSafePlatformCall, type FileContext, type LedgerRef } from "@stateward/core";
import { functionOfDeclaration, scanRunning, stripParentheses } from "./syntax.js";
import { fitted, oneLine, shorten } from "./text.js";
import { cannotRun, isJsonParse, NEVER_REJECTS, type Rejections } from "./rejects.js";

/**
 * `@neverRejects`: the function never rejects, so its callers need not catch. The tag is a
 * guarantee of the reference ledger (`@neverRejects`): its body is read, every function given to
 * a tagged prop or name is read, and every other use only calls or passes on what is read there.
 */

/** The trait a `@neverRejects` tag states in the reference ledger. */
const TRAIT = `@${NEVER_REJECTS}`;

/** The developer's own code in a message is cut to this many characters. */
const CODE_MAX = 50;

/** A declaration of this file that `@neverRejects` is written on. */
type Tagged = {
  readonly tag: ts.JSDocTag;
  /** The node a finding against it names: the declaration, or a property's name. */
  readonly declaration: ts.Node;
  readonly name: string;
  /** What the tag states a trait of. */
  readonly kind: "function" | "no-body" | "member" | "type" | "value";
  readonly body?: ts.ConciseBody;
};

/** What reading a function's body found: a place that surely rejects, or places that may. */
type Reading = {
  readonly contradiction: ts.Node | undefined;
  readonly unknown: readonly ts.Node[];
};

/** The node a finding against a declaration names, as the ledger lists it: a property by its name. */
function againstNode(node: ts.Node): ts.Node {
  return (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
    !ts.isComputedPropertyName(node.name)
    ? node.name
    : node;
}

function tagOf(node: ts.Node): ts.JSDocTag | undefined {
  return ts.getJSDocTags(node).find((tag) => tag.tagName.text === NEVER_REJECTS);
}

/** The declarations of this file tagged `@neverRejects`, in source order. */
function taggedIn(sourceFile: ts.SourceFile): Tagged[] {
  const found: Tagged[] = [];
  if (!sourceFile.text.includes(`@${NEVER_REJECTS}`)) return found;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name !== undefined
    ) {
      const tag = tagOf(node);
      if (tag !== undefined) {
        found.push({
          tag,
          declaration: node,
          name: node.name.getText(sourceFile),
          ...(node.body === undefined
            ? { kind: "no-body" as const }
            : { kind: "function" as const, body: node.body }),
        });
      }
    } else if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      const fn = functionOfDeclaration(node);
      const tag = tagOf(node) ?? (fn === undefined ? undefined : tagOf(fn));
      if (tag !== undefined) {
        const base = { tag, declaration: againstNode(node), name: node.name.getText(sourceFile) };
        if (fn?.body !== undefined) found.push({ ...base, kind: "function", body: fn.body });
        else if (ts.isPropertyDeclaration(node) && node.initializer === undefined) {
          found.push({ ...base, kind: "member" });
        } else found.push({ ...base, kind: "value" });
      }
    } else if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      const tag = tagOf(node);
      if (tag !== undefined) {
        found.push({
          tag,
          declaration: againstNode(node),
          name: node.name.getText(sourceFile),
          kind: "member",
        });
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      const tag = tagOf(node);
      if (tag !== undefined) {
        found.push({ tag, declaration: node, name: node.name.text, kind: "type" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * The first place in a body that surely rejects with nothing inside the function to catch it (a
 * `throw`, an awaited or returned call known to reject, a call that throws at once), and, when
 * there is none, every place that may reject that stateward cannot follow (a call into a package
 * with no facts, a dynamic `import()`, a promise held in a variable, a `for await`).
 */
function readBody(
  body: ts.ConciseBody,
  may: Rejections,
  certain: Rejections,
  ctx: FileContext,
): Reading {
  if (!ts.isBlock(body)) {
    if (certain(body)) return { contradiction: body, unknown: [] };
    const reads: ts.Node[] = [];
    scanRunning(body, (node) => {
      if (readMayThrow(node, ctx)) reads.push(node);
    });
    // A primitive value cannot reject (an object may be a thenable); what throws while it is
    // made is read above.
    const rejecting = !ctx.types.isPrimitive(body) && may(body);
    return { contradiction: undefined, unknown: [...(rejecting ? [body] : []), ...reads] };
  }
  let contradiction: ts.Node | undefined;
  const unknown: ts.Node[] = [];
  scanRunning(body, (node, guarded) => {
    if (contradiction !== undefined) return;
    // A `try` catches what it awaits or calls inside it, not a promise it returns without `await`
    // (`try { return post(); } catch { … }`): that one rejects after the `try` is left.
    if (guarded && !returnsUnawaited(node)) return;
    if (ts.isThrowStatement(node)) {
      if (!cannotRun(node, ctx)) contradiction = node;
    } else if (ts.isAwaitExpression(node)) {
      if (certain(node.expression)) contradiction = node.expression;
      else if (may(node.expression)) unknown.push(node.expression);
    } else if (ts.isCallExpression(node) && (isJsonParse(node) || certain.throwsCall(node))) {
      // A call that throws at once (`JSON.parse(text)`, a function of the project that throws).
      contradiction = node;
    } else if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      (throwsAtOnce(node) || !ctx.types.isPromiseLike(node)) &&
      mayThrowUnread(node, ctx)
    ) {
      // `new URL(text)`, `list.reduce(add)`: a call of the platform or a package that may throw
      // at once, which the proof does not read.
      unknown.push(node);
    } else if (ts.isReturnStatement(node) && node.expression !== undefined) {
      if (certain(node.expression)) contradiction = node.expression;
      // A primitive value cannot reject (an object may be a thenable); what throws while it is
      // made is read by
      // its calls and reads.
      else if (!ctx.types.isPrimitive(node.expression) && may(node.expression)) {
        unknown.push(node.expression);
      }
    } else if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) {
      // `for await`: what the iterator's promises reject with is not followed.
      unknown.push(node.expression);
    } else if (readMayThrow(node, ctx)) {
      unknown.push(node);
    }
  });
  return { contradiction, unknown: contradiction === undefined ? unknown : [] };
}

/**
 * A read that may throw, which the proof does not follow: a member of the project or a package
 * declared as a getter (a member declared as a property is read as one), or a read from an element
 * that may not be there (`xs[0].length` on an empty array). A property of the platform's types is
 * read as its lib declares it.
 */
function readMayThrow(node: ts.Node, ctx: FileContext): boolean {
  if (ts.isElementAccessExpression(node)) {
    const parent = node.parent;
    const readFurther =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === node;
    return readFurther && !ctx.types.readIsPlain(node);
  }
  if (!ts.isPropertyAccessExpression(node)) return false;
  // What a call is made on: the call is read.
  if (ts.isCallExpression(node.parent) && node.parent.expression === node) return false;
  return !ctx.types.isPlatformName(node.name) && !ctx.types.readIsPlain(node);
}

/** A `return` of a value that is not awaited first: a promise it gives rejects after any `try` around it. */
function returnsUnawaited(node: ts.Node): boolean {
  return (
    ts.isReturnStatement(node) &&
    node.expression !== undefined &&
    !ts.isAwaitExpression(stripParentheses(node.expression))
  );
}

/** Whether a call or `new` of the platform or a package, which the proof does not read, may throw. */
function mayThrowUnread(node: ts.CallExpression | ts.NewExpression, ctx: FileContext): boolean {
  // `fetch(url).then(…).catch(…)`: a link of a promise chain, read with the chain.
  if (startsChain(node)) return false;
  const callee = stripParentheses(node.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ts.isIdentifier(name) ? ctx.types.symbolAt(name) : undefined;
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  // A function of the project is read (a `throw` in it is a finding); a value whose declaration
  // is not found cannot be read.
  if (declared !== undefined && ctx.types.isOwnFile(declared.file)) return false;
  // The platform calls on the shared closed list do not throw; every other one may.
  return !isSafePlatformCall(node, ctx.types);
}

/** Whether a call is the start or a link of a promise chain: `p().then(…)`, `p().catch(…)`. */
function startsChain(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    ["then", "catch", "finally"].includes(parent.name.text) &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  );
}

/**
 * A call that throws at once, not one whose promise is awaited or returned; a `new` of anything
 * but `Promise` always does (`return new Array(n)` throws before any promise is made).
 */
function throwsAtOnce(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return true;
  if (ts.isNewExpression(node)) {
    const callee = stripParentheses(node.expression);
    if (!ts.isIdentifier(callee) || callee.text !== "Promise") return true;
  }
  return (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    !ts.isAwaitExpression(node.parent) &&
    !ts.isReturnStatement(node.parent) &&
    !ts.isArrowFunction(node.parent)
  );
}

/** What the finding names: the call that rejects, or the `throw`. */
function codeText(node: ts.Node): string {
  if (ts.isThrowStatement(node)) return "throw";
  const inner = ts.isExpression(node) ? stripParentheses(node) : node;
  if (ts.isCallExpression(inner)) {
    return `${shorten(oneLine(inner.expression.getText()), CODE_MAX)}(…)`;
  }
  if (ts.isNewExpression(inner))
    return `new ${shorten(oneLine(inner.expression.getText()), CODE_MAX)}(…)`;
  return shorten(oneLine(inner.getText()), CODE_MAX);
}

/** "throws", "`JSON.parse(…)` can throw", "`post(…)` can reject". */
function failsBy(node: ts.Node): string {
  if (ts.isThrowStatement(node)) return "it throws";
  return throwsAtOnce(node)
    ? `\`${codeText(node)}\` can throw`
    : `\`${codeText(node)}\` can reject`;
}

/** Whether the node is in a `catch` block: a `throw` there rethrows the failure it was to handle. */
function insideCatch(node: ts.Node): boolean {
  return ts.findAncestor(node, ts.isCatchClause) !== undefined;
}

const FIX = [
  "one of",
  "- catch the failure inside the function: `try { … } catch (error) { … }`",
  `- or remove \`@${NEVER_REJECTS}\`, so its callers handle the failure`,
].join("\n");

const UNKNOWN_HINT = `catch its failure inside the function, or state that it never rejects: \`@${NEVER_REJECTS}\` on a function of the project, \`facts\` for a package`;

/** The declaration a reference of another file names, as a finding names it. */
function declarationNode(ref: LedgerRef, node: ts.Node, ctx: FileContext): ts.Node | undefined {
  const symbol = ctx.types.symbolAt(node);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined) return undefined;
  const target = againstNode(declared.node);
  return `${declared.file}#${String(target.getStart())}` === ref.declaration ? target : undefined;
}

/**
 * The value a reference gives the tagged name (`onSearch={post}`, `{ onSearch: post }`,
 * `api.save = post`), or undefined when the reference gives none.
 */
function givenValue(node: ts.Node): ts.Node | undefined {
  const parent = node.parent;
  if (ts.isJsxAttribute(parent) && parent.name === node) {
    const value = parent.initializer;
    return value !== undefined && ts.isJsxExpression(value) ? value.expression : value;
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) return parent.initializer;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return parent;
  let outer: ts.Node = node;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) outer = parent;
  const at = outer.parent;
  if (
    ts.isBinaryExpression(at) &&
    at.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    at.left === outer
  ) {
    return at.right;
  }
  return undefined;
}

/**
 * Reads `@neverRejects` in one file: the body of each tagged function (a place that surely rejects
 * is a finding, one it cannot follow is "not checked"), and each reference the ledger lists: a
 * function given to a tagged name is read the same way; a call, an alias, an argument and an
 * import only use what is read where it is defined.
 */
export function checkNeverRejects(ctx: FileContext, may: Rejections, certain: Rejections): void {
  const { sourceFile } = ctx;
  const tagged = taggedIn(sourceFile);
  const read = new Map<number, ReturnType<typeof outcomeOfTag>>();
  for (const one of tagged) read.set(one.tag.getStart(sourceFile), outcomeOfTag(one));

  function outcomeOfTag(
    one: Tagged,
  ): { kind: "decided" | "irrelevant" } | { kind: "unchecked"; reason: string } {
    switch (one.kind) {
      case "function": {
        if (one.body === undefined) return { kind: "irrelevant" };
        const reading = readBody(one.body, may, certain, ctx);
        if (reading.contradiction !== undefined) {
          const at = reading.contradiction;
          ctx.report({
            node: at,
            message: fitted(
              (cut) =>
                `\`${cut(one.name)}\` is tagged \`@${NEVER_REJECTS}\`, but ${cut(failsBy(at))}`,
            ),
            hint: insideCatch(at) ? "the `catch` rethrows: handle the error there instead" : FIX,
            findingKind: "contradicted",
            related: [{ node: one.tag, message: `\`@${NEVER_REJECTS}\` is stated here` }],
            against: one.declaration,
          });
        }
        for (const place of reading.unknown) {
          ctx.unknown({
            message: fitted(
              (cut) =>
                `not checked: \`${cut(one.name)}\` is tagged \`@${NEVER_REJECTS}\`, and whether \`${cut(codeText(place))}\` ${throwsAtOnce(place) ? "throws" : "rejects"} is not known`,
            ),
            hint: UNKNOWN_HINT,
            node: place,
            against: one.declaration,
          });
        }
        return { kind: "decided" };
      }
      case "no-body":
        return {
          kind: "unchecked",
          reason: `\`${one.name}\` has no body to read: put the tag on a function written with its body`,
        };
      case "member":
        // A property or method of a type: what is given to it is read where it is given.
        return { kind: "irrelevant" };
      case "type":
        // A function type: each value of it is read, or not checked, where the type names it.
        return { kind: "irrelevant" };
      case "value":
        return {
          kind: "unchecked",
          reason: `\`${one.name}\` holds a value that is not a function written here: assign it an arrow function, written in place`,
        };
      default: {
        const unreachable: never = one.kind;
        return unreachable;
      }
    }
  }

  const refs = ctx.ledger.filter((ref) => ref.trait === TRAIT);
  if (refs.length === 0) return;
  const nodes = new Map<number, ts.Node>();
  const index = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) {
      nodes.set(node.getStart(sourceFile), node);
    }
    ts.forEachChild(node, index);
  };
  index(sourceFile);

  for (const ref of refs) {
    if (ref.form === "tag") {
      const outcome = read.get(ref.location.start);
      ctx.read(
        ref,
        outcome ?? {
          kind: "unchecked",
          reason: `\`${ref.text}\` is on a declaration that is not read for the tag: put it on a function, or on a \`const\` that holds an arrow function`,
        },
      );
      continue;
    }
    const node = nodes.get(ref.location.start);
    if (node === undefined) {
      ctx.read(ref, {
        kind: "unchecked",
        reason: `\`${ref.text}\` is not found in the file again: check again, and report it to stateward's authors if it stays`,
      });
      continue;
    }
    ctx.read(ref, outcomeOfRef(ref, node));
  }

  function outcomeOfRef(
    ref: LedgerRef,
    node: ts.Node,
  ): { kind: "decided" | "irrelevant" } | { kind: "unchecked"; reason: string } {
    if (ref.form === "type") {
      // `onSave: SaveHandler`: a value of a tagged function type is not followed to where it is made.
      return ref.declaration.endsWith(`#${String(ref.location.start)}`)
        ? { kind: "irrelevant" }
        : {
            kind: "unchecked",
            reason: `\`${ref.text}\` types a value with \`${ref.name}\`, which stateward does not check where the value is made: tag the function that makes it \`@${NEVER_REJECTS}\``,
          };
    }
    if (ref.form !== "write" && ref.form !== "jsx-attribute") return { kind: "irrelevant" };
    const value = givenValue(node);
    if (value === undefined) {
      return {
        kind: "unchecked",
        reason: `\`${ref.text}\` (a write) is a use of \`${ref.name}\` that stateward does not read for \`@${NEVER_REJECTS}\`: give the name one function, where it is declared`,
      };
    }
    return givenOutcome(ref, node, value);
  }

  /** A function given to a tagged name: read as a tagged body is. */
  function givenOutcome(
    ref: LedgerRef,
    node: ts.Node,
    value: ts.Node,
  ): { kind: "decided" } | { kind: "unchecked"; reason: string } {
    const shown = shorten(oneLine(value.getText(sourceFile)), CODE_MAX);
    const fn = functionGiven(value);
    if (fn === "tagged") return { kind: "decided" };
    if (fn?.body === undefined) {
      return {
        kind: "unchecked",
        reason: `\`${shown}\`, given to \`${ref.name}\`, is not a function stateward can read: give it an arrow function, written in place`,
      };
    }
    const declaration = declarationNode(ref, node, ctx);
    const reading = readBody(fn.body, may, certain, ctx);
    const inFile = (place: ts.Node): ts.Node =>
      place.getSourceFile() === sourceFile ? place : value;
    if (reading.contradiction !== undefined) {
      const at = reading.contradiction;
      // Against the declaration when the name resolves to it; else at the reference itself,
      // a place the guarantee covers (a JSX attribute names its prop only through the props type).
      ctx.report({
        node: declaration === undefined ? node : inFile(at),
        message: fitted(
          (cut) =>
            `\`${cut(ref.name)}\` is tagged \`@${NEVER_REJECTS}\`, but in the function given to it, ${cut(failsBy(at))}`,
        ),
        hint: FIX,
        findingKind: "contradicted",
        against: declaration ?? true,
      });
      return { kind: "decided" };
    }
    for (const place of reading.unknown) {
      if (declaration === undefined) {
        return {
          kind: "unchecked",
          reason: `whether \`${codeText(place)}\`, in \`${shown}\`, rejects is not known: ${UNKNOWN_HINT}`,
        };
      }
      ctx.unknown({
        message: fitted(
          (cut) =>
            `not checked: \`${cut(ref.name)}\` is tagged \`@${NEVER_REJECTS}\`, and whether \`${cut(codeText(place))}\`, in the function given to it, rejects is not known`,
        ),
        hint: UNKNOWN_HINT,
        node: inFile(place),
        against: declaration,
      });
    }
    return { kind: "decided" };
  }

  /**
   * The function a value given to a tagged name is: written in place, a method, or a function of
   * the project by name; "tagged" when that function is itself tagged `@neverRejects` (its own
   * guarantee reads it).
   */
  function functionGiven(
    value: ts.Node,
  ): { readonly body?: ts.ConciseBody | undefined } | "tagged" | undefined {
    if (ts.isMethodDeclaration(value)) return value;
    if (!ts.isExpression(value)) return undefined;
    const inner = stripParentheses(value);
    if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return inner;
    const name = ts.isPropertyAccessExpression(inner) ? inner.name : inner;
    if (!ts.isIdentifier(name)) return undefined;
    const symbol = ctx.types.symbolAt(name);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return undefined;
    const fn = functionOfDeclaration(declared.node);
    if (fn === undefined) return undefined;
    return tagOf(declared.node) !== undefined || tagOf(fn) !== undefined ? "tagged" : fn;
  }
}
