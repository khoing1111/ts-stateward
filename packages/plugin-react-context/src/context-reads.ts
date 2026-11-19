/**
 * Marks every reference to a context that states a trait (the reference ledger,
 * `FileContext.ledger`), for the rule that proves the trait. Each reference is read by its form:
 *
 * - an import, an export, a type, a closing tag or a `displayName` write runs nothing: irrelevant;
 * - a reader (`useContext(X)`, `use(X)`, `<X.Consumer>`, a hook of the project that reads it, a
 *   class's `contextType = X`): read by `provider-missing` when its walk records it; irrelevant to
 *   the proofs of `SingleProvider` and `Stable`, which are about Providers;
 * - a Provider (`<X.Provider>`, `<X value>`, another name for `X.Provider` used only as a tag):
 *   irrelevant to `RequiredContext` (a Provider the walk misses can only make a reader read as
 *   unprovided), read by `provider-nested` when it lists it, and by
 *   `provider-value-changes-every-render` when it read its `value`;
 * - anything else (another name for the context, the context passed to a call or stored in a
 *   literal, a Provider passed on): not checked, with what it is.
 */
import ts from "@stateward/core/typescript";
import type { FileContext, LedgerRef, ReadOutcome } from "@stateward/core";
import { reactName, unwrapped } from "./provider-value/react.js";
import { REQUIRED_CONTEXT, SINGLE_PROVIDER, STABLE_CONTEXT } from "./provider-missing/resolve.js";

/** What a reference to a context is, by the code around it. */
type ContextUse =
  | { kind: "inert" }
  /**
   * `direct`: React's `useContext(X)` or `use(X)` itself (or `<X.Consumer>`); `reads`: only reads
   * the context, directly or through a function of the project that only reads what it is given.
   */
  | { kind: "reader"; at: number; direct: boolean; reads: boolean }
  | { kind: "class-reader" }
  | { kind: "provider"; opening: ts.JsxOpeningLikeElement }
  | { kind: "provider-name"; tagsOnly: boolean }
  | { kind: "other"; reason: string };

/** What the rule that marks knows of the file: the reads and Providers it read. */
export type ContextReads = {
  /** `provider-missing`: the starts of the reads its walk records (a call, or a Consumer tag). */
  readonly reads?: ReadonlySet<number>;
  /** `provider-nested`: the starts of the opening tags of the Providers it lists. */
  readonly providers?: ReadonlySet<number>;
  /** `provider-value-changes-every-render`: the opening tags whose `value` it read. */
  readonly values?: ReadonlySet<ts.Node>;
};

/** The node of the file that starts at each offset: an identifier, a private name or a string. */
function namesByStart(sourceFile: ts.SourceFile): Map<number, ts.Node> {
  const found = new Map<number, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) {
      found.set(node.getStart(sourceFile), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The outermost expression that is `node`'s value: through `(…)`, `!`, `as` and `satisfies`. */
function outermost(node: ts.Node): ts.Node {
  let at = node;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isAsExpression(at.parent) ||
    ts.isSatisfiesExpression(at.parent) ||
    ts.isNonNullExpression(at.parent) ||
    ts.isTypeAssertionExpression(at.parent)
  ) {
    at = at.parent;
  }
  return at;
}

function isTagOf(element: ts.Node, tag: ts.Node): element is ts.JsxOpeningLikeElement {
  return (
    (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
    element.tagName === tag
  );
}

function isStatic(node: ts.PropertyDeclaration): boolean {
  return node.modifiers?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword) === true;
}

/** Whether every use of the name a declaration gives is a JSX tag of this file, and it is not exported. */
function usedOnlyAsTag(name: ts.Identifier, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(name);
  if (symbol === undefined) return false;
  const uses: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node !== name &&
      node.text === name.text &&
      ctx.types.symbolAt(node)?.id === symbol.id
    ) {
      uses.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return (
    uses.length > 0 &&
    uses.every(
      (node) =>
        isTagOf(node.parent, node) ||
        (ts.isJsxClosingElement(node.parent) && node.parent.tagName === node),
    )
  );
}

/** The function a declaration of the project declares: `function f`, `const f = () => …`. */
function functionOf(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionDeclaration(node)) return node;
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return undefined;
  const value = unwrapped(node.initializer);
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
}

/**
 * Whether a function of the project only reads the context it is given at `index`: every use of
 * that parameter in its body is the argument of React's `useContext` or `use`
 * (`function useRequired<T>(context: Context<T>) { const value = useContext(context); … }`).
 */
function onlyReads(call: ts.CallExpression, index: number, ctx: FileContext): boolean {
  const callee = unwrapped(call.expression);
  const symbol = ctx.types.symbolAt(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return false;
  const fn = functionOf(declared.node);
  const parameter = fn?.parameters[index];
  const body = fn !== undefined && "body" in fn ? fn.body : undefined;
  if (parameter === undefined || body === undefined || !ts.isIdentifier(parameter.name)) {
    return false;
  }
  const own = ctx.types.symbolAt(parameter.name);
  if (own === undefined) return false;
  let only = true;
  const visit = (node: ts.Node): void => {
    if (!only) return;
    if (
      ts.isIdentifier(node) &&
      node.text === own.name &&
      ctx.types.symbolAt(node)?.id === own.id
    ) {
      const outer = outermost(node);
      const at = outer.parent;
      const read =
        ts.isCallExpression(at) &&
        at.arguments[0] === outer &&
        ["useContext", "use"].includes(reactName(ctx.types, calleeOf(at)) ?? "");
      if (!read) only = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return only;
}

/** The name a call reaches its function by: `useContext` in `React.useContext(…)`. */
function calleeOf(call: ts.CallExpression): ts.Node {
  const callee = unwrapped(call.expression);
  return ts.isPropertyAccessExpression(callee) ? callee.name : callee;
}

/** What the forms the proof does not read do with the context, after the reference's code. */
const FORM_WORDS: Partial<Record<LedgerRef["form"], string>> = {
  alias:
    "gives the context another name, which stateward does not follow: use the context by its own name",
  argument:
    "passes the context to a call, which stateward does not follow: read it with `useContext` in a component or a hook",
  stored:
    "keeps the context in an object or array literal, which stateward does not follow: use the context by its own name",
  returned:
    "returns the context, which stateward does not follow: import the context where it is read",
};

/** What a reference to a context is (`ContextUse`), from its node. */
function useOf(ref: LedgerRef, node: ts.Node, ctx: FileContext): ContextUse {
  if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
    return { kind: "inert" };
  }
  const text = `\`${ref.text}\``;
  const parent = node.parent;
  // `<X value>` (React 19), and its closing tag.
  if (isTagOf(parent, node)) return { kind: "provider", opening: parent };
  if (ts.isJsxClosingElement(parent) && parent.tagName === node) return { kind: "inert" };
  const outer = outermost(node);
  const at = outer.parent;
  // `X.Provider`, `X.Consumer`, `X.displayName`.
  if (ts.isPropertyAccessExpression(at) && at.expression === outer) {
    const member = at.name.text;
    const holder = at.parent;
    if (member === "displayName") {
      return ts.isBinaryExpression(holder) && holder.left === at
        ? { kind: "inert" }
        : {
            kind: "other",
            reason: `${text} reads a member of the context that stateward does not check: read the context with \`useContext\``,
          };
    }
    if (member === "Provider" || member === "Consumer") {
      if (ts.isJsxClosingElement(holder) && holder.tagName === at) return { kind: "inert" };
      if (isTagOf(holder, at)) {
        return member === "Provider"
          ? { kind: "provider", opening: holder }
          : { kind: "reader", at: holder.getStart(ctx.sourceFile), direct: true, reads: true };
      }
      if (member === "Provider") {
        const declared = outermost(at).parent;
        if (
          ts.isVariableDeclaration(declared) &&
          ts.isIdentifier(declared.name) &&
          declared.initializer !== undefined &&
          outermost(at) === declared.initializer
        ) {
          return { kind: "provider-name", tagsOnly: usedOnlyAsTag(declared.name, ctx) };
        }
      }
      return {
        kind: "other",
        reason: `${text} passes the context's ${member} on, which stateward does not follow: write \`<${ref.name}.${member}>\` in JSX, or keep it in a \`const\` used only as a JSX tag`,
      };
    }
    return {
      kind: "other",
      reason: `${text} reads a member of the context that stateward does not check: read the context with \`useContext\``,
    };
  }
  // `const { Provider } = X`
  if (
    ts.isVariableDeclaration(at) &&
    at.initializer === outer &&
    ts.isObjectBindingPattern(at.name)
  ) {
    const names = at.name.elements;
    const providerOnly = names.every((element) => {
      const key = element.propertyName ?? element.name;
      return ts.isIdentifier(key) && key.text === "Provider" && ts.isIdentifier(element.name);
    });
    if (providerOnly && names.length > 0) {
      const tagsOnly = names.every(
        (element) => ts.isIdentifier(element.name) && usedOnlyAsTag(element.name, ctx),
      );
      return { kind: "provider-name", tagsOnly };
    }
    return {
      kind: "other",
      reason: `${text} takes the context apart, which stateward does not follow: write \`<${ref.name}.Provider>\` in JSX, or read the context with \`useContext\``,
    };
  }
  // `useContext(X)`, `use(X)`, a hook of the project given the context.
  if (ts.isCallExpression(at) && at.arguments.some((argument) => argument === outer)) {
    const react = reactName(ctx.types, calleeOf(at));
    const direct = at.arguments[0] === outer && (react === "useContext" || react === "use");
    return {
      kind: "reader",
      at: at.getStart(ctx.sourceFile),
      direct,
      reads:
        direct ||
        onlyReads(
          at,
          at.arguments.findIndex((argument) => argument === outer),
          ctx,
        ),
    };
  }
  // `static contextType = X` in a class component.
  if (
    ts.isPropertyDeclaration(at) &&
    at.initializer === outer &&
    isStatic(at) &&
    ts.isIdentifier(at.name) &&
    at.name.text === "contextType"
  ) {
    return { kind: "class-reader" };
  }
  const what =
    FORM_WORDS[ref.form] ??
    "uses the context in a way stateward does not check: read it with `useContext` in a component or a hook";
  return { kind: "other", reason: `${text} ${what}` };
}

/** What the rule proving `trait` says of a use. */
function outcomeOf(
  trait: string,
  use: Exclude<ContextUse, { kind: "inert" }>,
  ref: LedgerRef,
  known: ContextReads,
): ReadOutcome {
  const text = `\`${ref.text}\``;
  if (use.kind === "other") return { kind: "unchecked", reason: use.reason };
  if (trait === REQUIRED_CONTEXT) {
    switch (use.kind) {
      case "reader":
        return known.reads?.has(use.at) === true
          ? { kind: "decided" }
          : {
              kind: "unchecked",
              reason: use.direct
                ? `${text} reads the context outside a component or hook that stateward follows: read it in a function component, or a hook named \`use…\``
                : `${text} passes the context to a call, which stateward does not follow: read it with \`useContext(${ref.name})\` in a component or a hook`,
            };
      case "class-reader":
        return {
          kind: "unchecked",
          reason: `${text} reads the context in a class component, which stateward does not follow: read it with \`useContext(${ref.name})\` in a function component`,
        };
      case "provider":
      case "provider-name":
        return { kind: "irrelevant" };
    }
  }
  switch (use.kind) {
    case "reader":
      return use.reads
        ? { kind: "irrelevant" }
        : {
            kind: "unchecked",
            reason: `${text} passes the context to a call, which stateward does not follow: render \`<${ref.name}.Provider>\` in a component's JSX, and read the context with \`useContext(${ref.name})\``,
          };
    case "class-reader":
      return { kind: "irrelevant" };
    case "provider-name":
      return trait === SINGLE_PROVIDER && use.tagsOnly
        ? { kind: "decided" }
        : {
            kind: "unchecked",
            reason: `${text} gives the Provider another name, which stateward does not follow: write \`<${ref.name}.Provider>\` in JSX, or keep it in a \`const\` used only as a JSX tag`,
          };
    case "provider": {
      const read =
        trait === SINGLE_PROVIDER
          ? known.providers?.has(use.opening.getStart()) === true
          : trait === STABLE_CONTEXT && known.values?.has(use.opening) === true;
      return read
        ? { kind: "decided" }
        : {
            kind: "unchecked",
            reason:
              trait === STABLE_CONTEXT
                ? `${text} is a Provider whose \`value\` stateward does not check: render it in a component, with a \`value\` prop written on it`
                : `${text} is a Provider that stateward does not follow: render it in a component's JSX`,
          };
    }
  }
}

/** Marks the file's references to contexts stating `trait`, for the rule that proves it. */
export function markContextReferences(ctx: FileContext, trait: string, known: ContextReads): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === trait);
  if (refs.length === 0) return;
  const nodes = namesByStart(ctx.sourceFile);
  for (const ref of refs) {
    const node = nodes.get(ref.location.start);
    if (node === undefined) {
      ctx.read(ref, {
        kind: "unchecked",
        reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read: use the context by its own name`,
      });
      continue;
    }
    const use = useOf(ref, node, ctx);
    ctx.read(
      ref,
      use.kind === "inert" ? { kind: "irrelevant" } : outcomeOf(trait, use, ref, known),
    );
  }
}
