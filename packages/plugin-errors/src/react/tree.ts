import ts from "@stateward/core/typescript";
import type { FileContext, Json, StringListRecord, TypeQueries } from "@stateward/core";
import { classIdOf, packageNameOf } from "../inference/summarize.js";
import { each, fieldsOf, isString, readStrings, spanOf } from "../inference/summary.js";
import { scanRunning, stripParentheses } from "../syntax.js";
import { ALL_GUARDS, guardThrows, type GuardSkips } from "./render-guards.js";

/**
 * What one file renders, for the boundary rules and hover:
 * its components and hooks, the components each renders and the error boundaries around each
 * render, the app's entry points, and every boundary element with its fallbacks. Plain JSON, so
 * the engine caches it with the file.
 */

/** A start and end offset in the summarized file. */
export type Span = readonly [number, number];

/**
 * What is around a render inside the component that writes it, innermost first: a boundary
 * element (by key), or an own component whose `children` it is passed as (by id), which may put
 * them under a boundary of its own.
 */
export type Around = { readonly boundary: string } | { readonly via: string };

export type TreeRender = {
  /** The id of the own component or class the tag names. */
  readonly target: string;
  /** The tag as written. */
  readonly name: string;
  readonly at: Span;
  readonly around: readonly Around[];
  /**
   * The element goes where stateward cannot follow it (passed to a function, stored in an
   * object): which boundary is above it is not known, so nothing is reported for it.
   */
  readonly unknown: boolean;
};

/** The parts of a boundary that receive the error it catches. */
export type FallbackKind =
  "FallbackComponent" | "fallbackRender" | "onError" | "getDerivedStateFromError";

export const FALLBACK_KINDS: readonly FallbackKind[] = [
  "FallbackComponent",
  "fallbackRender",
  "onError",
  "getDerivedStateFromError",
];

/** How a fallback branches on the error with `instanceof`. */
export type Chain = {
  /** The file of the fallback's code (a `FallbackComponent` may live in another file). */
  readonly file: string;
  /** The first `if`, `switch` or `?:` of the chain. */
  readonly at: Span;
  /** How the error is written in the tests: `error`, `props.error`. */
  readonly variable: string;
  readonly dispatch: "if" | "switch";
  /** The classes each branch names (ids); a branch with a class that resolves to nothing is `null`. */
  readonly branches: readonly (readonly string[] | null)[];
  /** Every test is only `instanceof` tests joined by `||`. */
  readonly exact: boolean;
  /** A final `else`, `default`, or code after the chain that does more than return nothing. */
  readonly generic: boolean;
};

export type Fallback = {
  readonly kind: FallbackKind;
  /** The prop on the element, or the element's tag for a class's `getDerivedStateFromError`. */
  readonly at: Span;
  /** How messages name it: `UserError`, `fallbackRender`, `AppBoundary.getDerivedStateFromError`. */
  readonly name: string;
  readonly chain: Chain | null;
};

export type BoundaryElement = {
  /** `<file>:<offset of the element>`. */
  readonly key: string;
  readonly name: string;
  /** The tag name. */
  readonly at: Span;
  readonly fallbacks: readonly Fallback[];
};

/** An effect callback, by the offset its function starts at (how the throws facts name it). */
export type TreeFunction = {
  readonly id: string;
  readonly name: string;
  readonly at: Span;
  readonly kind: "component" | "hook" | "class";
  readonly renders: readonly TreeRender[];
  /** Own hooks it calls, by id. */
  readonly hooks: readonly string[];
  /** The offsets of the `useEffect` / `useLayoutEffect` callbacks written in it. */
  readonly effects: readonly number[];
  /** A class's render and lifecycle methods, by id. */
  readonly methods: readonly string[];
  /** The boundaries around every place it renders `children`, innermost first; null for none. */
  readonly children: readonly string[] | null;
  /** Where the guard throws in its body start (render-guards.ts): not counted as render failures. */
  readonly guards: readonly number[];
};

export type TreeSummary = {
  readonly functions: readonly TreeFunction[];
  /** What `createRoot(…).render(…)` and `hydrateRoot(…)` render. */
  readonly entries: readonly TreeRender[];
  readonly boundaries: readonly BoundaryElement[];
};

const EFFECT_HOOKS: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);
/** The class methods React runs while rendering or committing: their errors reach a boundary. */
const CLASS_METHODS: ReadonlySet<string> = new Set([
  "render",
  "componentDidMount",
  "componentDidUpdate",
  "constructor",
]);
/** The error boundaries from packages that are known without a config: package to components. */
export const LIBRARY_BOUNDARIES: StringListRecord = { "react-error-boundary": ["ErrorBoundary"] };

type RenderFunction = {
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.ClassDeclaration;
  name: ts.Identifier;
  kind: TreeFunction["kind"];
};

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function isJsx(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/** Has JSX, or calls a hook, outside nested functions: the body of a component. */
function looksLikeComponent(body: ts.Node): boolean {
  let found = false;
  scanRunning(body, (node) => {
    if (isJsx(node)) found = true;
    else if (ts.isCallExpression(node)) {
      const callee = stripParentheses(node.expression);
      if (ts.isIdentifier(callee) && isHookName(callee.text)) found = true;
    }
  });
  return found;
}

function renderFunctionOf(node: ts.Node): RenderFunction | undefined {
  if (ts.isClassDeclaration(node)) {
    const extendsSomething = node.heritageClauses?.some(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    );
    const renders = node.members.some(
      (member) =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === "render",
    );
    return node.name !== undefined && extendsSomething === true && renders
      ? { node, name: node.name, kind: "class" }
      : undefined;
  }
  let fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined;
  let name: ts.Identifier | undefined;
  if (ts.isFunctionDeclaration(node)) {
    fn = node;
    name = node.name;
  } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const value = stripParentheses(node.initializer);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      fn = value;
      name = node.name;
    }
  }
  if (fn === undefined || name === undefined || fn.body === undefined) return undefined;
  if (isHookName(name.text)) return { node: fn, name, kind: "hook" };
  return /^[A-Z]/.test(name.text) && looksLikeComponent(fn.body)
    ? { node: fn, name, kind: "component" }
    : undefined;
}

/** The node of a tag that names what it renders: `Card` in `<UI.Card>`. */
function tagName(tag: ts.JsxTagNameExpression): ts.Node | undefined {
  if (ts.isIdentifier(tag)) return /^[a-z]/.test(tag.text) ? undefined : tag;
  return ts.isPropertyAccessExpression(tag) ? tag.name : undefined;
}

function openingOf(element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

/** What a tag names: an own component or class (by id), a boundary, or neither. */
type Tag = {
  readonly target: string | undefined;
  /** Set for an error boundary: the class, when it is one of the project's. */
  readonly boundary: { readonly own: ts.ClassLikeDeclaration | null } | undefined;
};

function isBoundaryClass(node: ts.Node): node is ts.ClassLikeDeclaration {
  return (
    (ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
    node.members.some(
      (member) =>
        member.name !== undefined &&
        ts.isIdentifier(member.name) &&
        (member.name.text === "getDerivedStateFromError" ||
          member.name.text === "componentDidCatch"),
    )
  );
}

function classifyTag(
  types: TypeQueries,
  tag: ts.JsxTagNameExpression,
  libraryBoundaries: StringListRecord,
): Tag {
  const name = tagName(tag);
  const symbol = name === undefined ? undefined : types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (symbol === undefined || declaration === undefined) {
    return { target: undefined, boundary: undefined };
  }
  if (!types.isOwnFile(declaration.file)) {
    const library = packageNameOf(types, declaration.file);
    const isLibraryBoundary = (libraryBoundaries[library] ?? []).includes(symbol.name);
    return { target: undefined, boundary: isLibraryBoundary ? { own: null } : undefined };
  }
  return {
    target: symbol.id,
    boundary: isBoundaryClass(declaration.node) ? { own: declaration.node } : undefined,
  };
}

// ---- fallbacks ----------------------------------------------------------------------------------

type ErrorRef = { names: Set<string>; props: Set<string> };

function refersToError(expression: ts.Expression, ref: ErrorRef): boolean {
  const e = stripParentheses(expression);
  if (ts.isIdentifier(e)) return ref.names.has(e.text);
  return (
    ts.isPropertyAccessExpression(e) &&
    e.name.text === "error" &&
    ts.isIdentifier(e.expression) &&
    ref.props.has(e.expression.text)
  );
}

/** The names `{ error }` binds from a pattern. */
function errorBindings(pattern: ts.BindingName, into: Set<string>): void {
  if (!ts.isObjectBindingPattern(pattern)) return;
  for (const element of pattern.elements) {
    const property = element.propertyName ?? element.name;
    if (ts.isIdentifier(property) && property.text === "error" && ts.isIdentifier(element.name)) {
      into.add(element.name.text);
    }
  }
}

/** Where the error is in a fallback component's props: `{ error }`, `props.error`. */
function propsRef(fn: ts.SignatureDeclaration): ErrorRef {
  const ref: ErrorRef = { names: new Set(), props: new Set() };
  const parameter = fn.parameters[0];
  if (parameter === undefined) return ref;
  if (ts.isIdentifier(parameter.name)) ref.props.add(parameter.name.text);
  else errorBindings(parameter.name, ref.names);
  return ref;
}

/** The error is the first parameter (`onError`, `getDerivedStateFromError`). */
function parameterRef(fn: ts.SignatureDeclaration): ErrorRef {
  const parameter = fn.parameters[0];
  const names = new Set<string>();
  if (parameter !== undefined && ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
  return { names, props: new Set() };
}

type Test = { classes: ts.Expression[]; exact: boolean; variable: string };

/** The classes `error instanceof A || error instanceof B` names; undefined for a test of something else. */
function instanceofTest(condition: ts.Expression, ref: ErrorRef): Test | undefined {
  const e = stripParentheses(condition);
  if (!ts.isBinaryExpression(e)) return undefined;
  const operator = e.operatorToken.kind;
  if (operator === ts.SyntaxKind.InstanceOfKeyword) {
    return refersToError(e.left, ref)
      ? { classes: [e.right], exact: true, variable: stripParentheses(e.left).getText() }
      : undefined;
  }
  if (
    operator !== ts.SyntaxKind.BarBarToken &&
    operator !== ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return undefined;
  }
  const left = instanceofTest(e.left, ref);
  const right = instanceofTest(e.right, ref);
  const found = left ?? right;
  if (found === undefined) return undefined;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return { ...found, exact: false };
  // `a || other`: what `other` lets through is not known.
  if (left === undefined || right === undefined) return { ...found, exact: false };
  return {
    classes: [...left.classes, ...right.classes],
    exact: left.exact && right.exact,
    variable: left.variable,
  };
}

function isNothing(expression: ts.Expression | undefined): boolean {
  if (expression === undefined) return true;
  const e = stripParentheses(expression);
  return e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined");
}

/** Whether these statements do something for an error no branch named: not just `return null`. */
function isGeneric(statements: readonly ts.Statement[]): boolean {
  return statements.some((statement) => {
    if (ts.isReturnStatement(statement)) return !isNothing(statement.expression);
    if (ts.isBlock(statement)) return isGeneric(statement.statements);
    return !ts.isEmptyStatement(statement);
  });
}

function statementsOf(statement: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(statement) ? statement.statements : [statement];
}

function exits(statement: ts.Statement): boolean {
  const last = statementsOf(statement).at(-1);
  return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

type Found = Omit<Chain, "file" | "branches"> & { classes: (readonly ts.Expression[])[] };

/** `a instanceof X ? … : b instanceof Y ? … : other`. */
function ternaryChain(expression: ts.Expression, ref: ErrorRef): Found | undefined {
  let e = stripParentheses(expression);
  if (!ts.isConditionalExpression(e)) return undefined;
  const start = e;
  const classes: (readonly ts.Expression[])[] = [];
  let exact = true;
  let variable: string | undefined;
  for (;;) {
    const test = ts.isConditionalExpression(e) ? instanceofTest(e.condition, ref) : undefined;
    if (!ts.isConditionalExpression(e) || test === undefined) break;
    classes.push(test.classes);
    exact &&= test.exact;
    variable ??= test.variable;
    e = stripParentheses(e.whenFalse);
  }
  if (variable === undefined) return undefined;
  return {
    at: [start.getStart(), start.getEnd()],
    variable,
    dispatch: "if",
    classes,
    exact,
    generic: !isNothing(e),
  };
}

/** The `instanceof` chain of a function body, from its first statement that branches on the error. */
function blockChain(statements: readonly ts.Statement[], ref: ErrorRef): Found | undefined {
  for (const [index, statement] of statements.entries()) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      const found = ternaryChain(statement.expression, ref);
      if (found !== undefined) return found;
    }
    if (ts.isSwitchStatement(statement)) {
      if (statement.expression.kind !== ts.SyntaxKind.TrueKeyword) continue;
      const classes: (readonly ts.Expression[])[] = [];
      let exact = true;
      let variable: string | undefined;
      let generic: boolean | undefined;
      for (const clause of statement.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) {
          generic = isGeneric(clause.statements);
          continue;
        }
        const test = instanceofTest(clause.expression, ref);
        if (test === undefined) {
          exact = false;
          continue;
        }
        classes.push(test.classes);
        exact &&= test.exact;
        variable ??= test.variable;
      }
      if (variable === undefined) continue;
      return {
        at: [statement.getStart(), statement.getEnd()],
        variable,
        dispatch: "switch",
        classes,
        exact,
        generic: generic ?? isGeneric(statements.slice(index + 1)),
      };
    }
    if (!ts.isIfStatement(statement) || instanceofTest(statement.expression, ref) === undefined) {
      continue;
    }
    return ifChain(statements, index, ref);
  }
  return undefined;
}

/** An `if` / `else if` chain, or `if (…) return …;` statements one after another, then the rest. */
function ifChain(statements: readonly ts.Statement[], from: number, ref: ErrorRef): Found {
  const first = statements[from];
  const classes: (readonly ts.Expression[])[] = [];
  let exact = true;
  let variable = "";
  let index = from;
  for (;;) {
    const statement = statements[index];
    const test =
      statement !== undefined && ts.isIfStatement(statement)
        ? instanceofTest(statement.expression, ref)
        : undefined;
    if (statement === undefined || !ts.isIfStatement(statement) || test === undefined) break;
    let link: ts.IfStatement = statement;
    let linkTest: Test = test;
    let closed: boolean | undefined;
    for (;;) {
      classes.push(linkTest.classes);
      exact &&= linkTest.exact;
      if (variable === "") variable = linkTest.variable;
      const otherwise = link.elseStatement;
      if (otherwise === undefined) break;
      const next = ts.isIfStatement(otherwise)
        ? instanceofTest(otherwise.expression, ref)
        : undefined;
      if (ts.isIfStatement(otherwise) && next !== undefined) {
        link = otherwise;
        linkTest = next;
        continue;
      }
      closed = isGeneric(statementsOf(otherwise));
      break;
    }
    if (closed !== undefined) {
      return { at: span(first), variable, dispatch: "if", classes, exact, generic: closed };
    }
    index += 1;
    if (!exits(link.thenStatement)) break;
  }
  return {
    at: span(first),
    variable,
    dispatch: "if",
    classes,
    exact,
    generic: isGeneric(statements.slice(index)),
  };
}

function span(node: ts.Node | undefined): Span {
  return node === undefined ? [0, 0] : [node.getStart(), node.getEnd()];
}

/** How a fallback function branches on the error; null when it does not. */
function chainOf(
  types: TypeQueries,
  fn: ts.SignatureDeclaration & { readonly body?: ts.ConciseBody | undefined },
  ref: ErrorRef,
): Chain | null {
  const body = fn.body;
  if (body === undefined) return null;
  let found: Found | undefined;
  if (ts.isBlock(body)) {
    // `const { error } = props;` at the top binds the error too.
    for (const statement of body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (value !== undefined && ts.isIdentifier(value) && ref.props.has(value.text)) {
          errorBindings(declaration.name, ref.names);
        }
      }
    }
    found = blockChain(body.statements, ref);
  } else {
    found = ternaryChain(body, ref);
  }
  if (found === undefined) return null;
  const { classes, ...rest } = found;
  const branches = classes.map((names) => {
    const ids = names.map((name) =>
      classIdOf(types, ts.isPropertyAccessExpression(name) ? name.name : name),
    );
    return ids.every((id) => id !== undefined) ? ids : null;
  });
  return { ...rest, file: fn.getSourceFile().fileName, branches };
}

type FunctionLike = ts.SignatureDeclaration & { readonly body?: ts.ConciseBody | undefined };

/** The function a prop's value is: written in place, or a name of an own function. */
function functionOfValue(types: TypeQueries, value: ts.Expression): FunctionLike | undefined {
  const e = stripParentheses(value);
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
  if (!ts.isIdentifier(e)) return undefined;
  const symbol = types.symbolAt(e);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (declaration === undefined || !types.isOwnFile(declaration.file)) return undefined;
  const node = declaration.node;
  if (ts.isFunctionDeclaration(node)) return node;
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    const init = stripParentheses(node.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  }
  return undefined;
}

function fallbacksOf(
  types: TypeQueries,
  opening: ts.JsxOpeningLikeElement,
  tag: Tag,
  sourceFile: ts.SourceFile,
): Fallback[] {
  const own = tag.boundary?.own;
  if (own !== undefined && own !== null) {
    const method = own.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === "getDerivedStateFromError",
    );
    if (method === undefined) return [];
    return [
      {
        kind: "getDerivedStateFromError",
        at: [opening.tagName.getStart(sourceFile), opening.tagName.getEnd()],
        name: `${own.name?.text ?? "boundary"}.getDerivedStateFromError`,
        chain: chainOf(types, method, parameterRef(method)),
      },
    ];
  }
  const found: Fallback[] = [];
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
    const kind = FALLBACK_KINDS.find((one) => one === attribute.name.getText(sourceFile));
    const value =
      attribute.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
        ? attribute.initializer.expression
        : undefined;
    if (kind === undefined || value === undefined) continue;
    const fn = functionOfValue(types, value);
    const valueText = stripParentheses(value);
    found.push({
      kind,
      at: [attribute.getStart(sourceFile), attribute.getEnd()],
      name: ts.isIdentifier(valueText) ? valueText.text : kind,
      chain:
        fn === undefined
          ? null
          : chainOf(types, fn, kind === "onError" ? parameterRef(fn) : propsRef(fn)),
    });
  }
  return found;
}

// ---- the file -----------------------------------------------------------------------------------

/** Whether `call` renders an app: `createRoot(el).render(<App/>)`, `hydrateRoot(el, <App/>)`. */
function entryArgument(types: TypeQueries, call: ts.CallExpression): ts.Expression | undefined {
  const fromReactDom = (expression: ts.Expression, name: string): boolean => {
    const e = stripParentheses(expression);
    const symbol = ts.isIdentifier(e) ? types.symbolAt(e) : undefined;
    const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
    return (
      symbol?.name === name &&
      declaration !== undefined &&
      !types.isOwnFile(declaration.file) &&
      packageNameOf(types, declaration.file) === "react-dom"
    );
  };
  const isRoot = (expression: ts.Expression): boolean => {
    const e = stripParentheses(expression);
    if (ts.isCallExpression(e)) return fromReactDom(e.expression, "createRoot");
    if (!ts.isIdentifier(e)) return false;
    const symbol = types.symbolAt(e);
    const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
    const node = declaration?.node;
    return (
      node !== undefined &&
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      ts.isCallExpression(stripParentheses(node.initializer)) &&
      isRoot(node.initializer)
    );
  };
  const callee = stripParentheses(call.expression);
  if (fromReactDom(callee, "hydrateRoot")) return call.arguments[1];
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "render") {
    return isRoot(callee.expression) ? call.arguments[0] : undefined;
  }
  return undefined;
}

/** How many variables deep JSX is followed (`const page = <Layout>{content}</Layout>`). */
const MAX_HOLDERS = 5;

/**
 * The local variable `child` is stored in: `const content = <A/>`, or `content = <A/>` for a
 * `let`. Undefined for anything else.
 */
function heldIn(parent: ts.Node, child: ts.Node): ts.Identifier | undefined {
  if (ts.isVariableDeclaration(parent) && parent.initializer === child) {
    return ts.isIdentifier(parent.name) ? parent.name : undefined;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === child &&
    ts.isIdentifier(parent.left)
  ) {
    return parent.left;
  }
  return undefined;
}

/** An identifier that is written, not read: `content = …`. */
function isWrite(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isBinaryExpression(parent) &&
      parent.left === node &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
    (ts.isVariableDeclaration(parent) && parent.name === node)
  );
}

/**
 * Where the value stops being followed and is rendered where it is: returned (from the
 * component, or a callback such as `items.map(…)`), or the body of an arrow function.
 */
function isFunctionBoundaryOrStatement(parent: ts.Node, child: ts.Node): boolean {
  return (
    ts.isReturnStatement(parent) ||
    ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.body === child) ||
    ts.isStatement(parent) ||
    ts.isBlock(parent)
  );
}

/** Nodes the JSX passes through unchanged on its way to where it is rendered. */
function passesValue(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isParenthesizedExpression(parent) || ts.isJsxExpression(parent)) return true;
  if (ts.isJsxAttribute(parent) || ts.isJsxAttributes(parent)) return true;
  if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxFragment(parent)) {
    return true;
  }
  if (ts.isJsxOpeningElement(parent)) return true;
  if (ts.isConditionalExpression(parent)) return parent.condition !== child;
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    return (
      parent.right === child &&
      (operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken)
    );
  }
  return false;
}

export function summarizeTree(
  ctx: FileContext,
  libraryBoundaries: StringListRecord = LIBRARY_BOUNDARIES,
  skips: GuardSkips = ALL_GUARDS,
): TreeSummary {
  const { sourceFile, types } = ctx;
  const file = sourceFile.fileName;
  const spanOf = (node: ts.Node): Span => [node.getStart(sourceFile), node.getEnd()];
  const tags = new Map<ts.JsxOpeningLikeElement, Tag>();
  const tagOf = (opening: ts.JsxOpeningLikeElement): Tag => {
    let tag = tags.get(opening);
    if (tag === undefined) {
      tag = classifyTag(types, opening.tagName, libraryBoundaries);
      tags.set(opening, tag);
    }
    return tag;
  };
  const boundaries: BoundaryElement[] = [];
  const keyOf = (element: ts.Node): string => `${file}:${String(element.getStart(sourceFile))}`;

  /**
   * Where `node` is rendered, up to `stop`: for each place, the boundaries and own components
   * around it, innermost first; null for a place it cannot be followed to. JSX held in a local
   * variable is placed where the variable is used, as React renders it there.
   */
  const placementsOf = (node: ts.Node, stop: ts.Node, depth = 0): (Around[] | null)[] => {
    const around: Around[] = [];
    // While true, `child` is the JSX value itself (or what it flows into unchanged).
    let tracking = true;
    let child = node;
    for (let parent = node.parent; parent !== stop && !ts.isSourceFile(parent);) {
      if (
        ts.isJsxElement(parent) &&
        child !== parent.openingElement &&
        child !== parent.closingElement
      ) {
        const tag = tagOf(parent.openingElement);
        if (tag.boundary !== undefined) around.push({ boundary: keyOf(parent) });
        else if (tag.target !== undefined) around.push({ via: tag.target });
      } else if (tracking) {
        const held = heldIn(parent, child);
        if (held !== undefined) {
          return depth >= MAX_HOLDERS ? [null] : usesOf(held, stop, around, depth);
        }
        if (isFunctionBoundaryOrStatement(parent, child)) tracking = false;
        else if (!passesValue(parent, child)) return [null];
      }
      child = parent;
      parent = parent.parent;
    }
    return [around];
  };

  /** Each place the variable `held` is read, below `stop`, with `inner` around it first. */
  const usesOf = (
    held: ts.Identifier,
    stop: ts.Node,
    inner: readonly Around[],
    depth: number,
  ): (Around[] | null)[] => {
    const id = types.symbolAt(held)?.id;
    if (id === undefined) return [null];
    const places: (Around[] | null)[] = [];
    const walk = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text === held.text &&
        node !== held &&
        !isWrite(node) &&
        types.symbolAt(node)?.id === id
      ) {
        for (const place of placementsOf(node, stop, depth + 1)) {
          places.push(place === null ? null : [...inner, ...place]);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(stop);
    return places;
  };

  const functionNodes = new Set<ts.Node>();
  const found: RenderFunction[] = [];
  const findFunctions = (node: ts.Node): void => {
    const fn = renderFunctionOf(node);
    if (fn !== undefined) {
      found.push(fn);
      functionNodes.add(fn.node);
    }
    ts.forEachChild(node, findFunctions);
  };
  findFunctions(sourceFile);

  /** Each JSX element under `root` (not in another render function), with what it renders. */
  const elementsIn = (
    root: ts.Node,
    visit: (element: ts.JsxElement | ts.JsxSelfClosingElement) => void,
  ) => {
    const walk = (node: ts.Node): void => {
      if (node !== root && functionNodes.has(node)) return;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) visit(node);
      ts.forEachChild(node, walk);
    };
    walk(root);
  };

  const rendersOf = (
    element: ts.JsxElement | ts.JsxSelfClosingElement,
    stop: ts.Node,
  ): TreeRender[] => {
    const opening = openingOf(element);
    const tag = tagOf(opening);
    if (tag.boundary !== undefined) {
      boundaries.push({
        key: keyOf(element),
        name: opening.tagName.getText(sourceFile),
        at: spanOf(opening.tagName),
        fallbacks: fallbacksOf(types, opening, tag, sourceFile),
      });
    }
    const target = tag.target;
    if (target === undefined) return [];
    const seen = new Set<string>();
    return placementsOf(element, stop).flatMap((around): TreeRender[] => {
      const key = JSON.stringify(around);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          target,
          name: opening.tagName.getText(sourceFile),
          at: spanOf(opening),
          around: around ?? [],
          unknown: around === null,
        },
      ];
    });
  };

  const functions: TreeFunction[] = [];
  for (const fn of found) {
    const symbol = types.symbolAt(fn.name);
    if (symbol === undefined) continue;
    const renders: TreeRender[] = [];
    elementsIn(fn.node, (element) => {
      renders.push(...rendersOf(element, fn.node));
    });
    const hooks: string[] = [];
    const effects: number[] = [];
    const methods: string[] = [];
    let children: string[] | null = null;
    if (fn.kind === "class" && ts.isClassDeclaration(fn.node)) {
      for (const member of fn.node.members) {
        const name =
          ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) ? member.name : undefined;
        const id =
          name === undefined || !CLASS_METHODS.has(name.text)
            ? undefined
            : types.symbolAt(name)?.id;
        if (id !== undefined) methods.push(id);
      }
    } else if (!ts.isClassDeclaration(fn.node) && fn.node.body !== undefined) {
      scanRunning(fn.node.body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = stripParentheses(node.expression);
        const name = ts.isIdentifier(callee)
          ? callee
          : ts.isPropertyAccessExpression(callee)
            ? callee.name
            : undefined;
        const called = name === undefined ? undefined : types.symbolAt(name);
        const declaration = called === undefined ? undefined : types.declarationOf(called);
        if (called === undefined || declaration === undefined) return;
        if (types.isOwnFile(declaration.file)) {
          if (isHookName(called.name)) hooks.push(called.id);
          return;
        }
        const effect = node.arguments[0];
        if (
          EFFECT_HOOKS.has(called.name) &&
          packageNameOf(types, declaration.file) === "react" &&
          effect !== undefined
        ) {
          const callback = stripParentheses(effect);
          if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
            effects.push(callback.getStart(sourceFile));
          }
        }
      });
      if (fn.kind === "component") {
        elementsInExpressions(fn.node, functionNodes, (expression) => {
          const value = stripParentheses(expression);
          const isChildren =
            (ts.isIdentifier(value) && value.text === "children") ||
            (ts.isPropertyAccessExpression(value) && value.name.text === "children");
          if (!isChildren) return;
          for (const place of placementsOf(value, fn.node)) {
            const boundaryKeys = (place ?? []).flatMap((one) =>
              "boundary" in one ? [one.boundary] : [],
            );
            children =
              children === null
                ? boundaryKeys
                : children.filter((key) => boundaryKeys.includes(key));
          }
        });
      }
    }
    functions.push({
      id: symbol.id,
      // `export default function App` is bound as `default`; the developer knows it as `App`.
      name: symbol.name === "default" ? fn.name.text : symbol.name,
      at: spanOf(fn.name),
      kind: fn.kind,
      renders,
      hooks: [...new Set(hooks)],
      effects,
      methods,
      children,
      guards: ts.isClassDeclaration(fn.node) ? [] : guardThrows(fn.node, ctx, skips),
    });
  }

  // Boundaries outside render functions (at an entry) are found while reading the entries.
  const entries: TreeRender[] = [];
  const findEntries = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const argument = entryArgument(types, node);
      if (argument !== undefined) {
        elementsIn(argument, (element) => {
          entries.push(...rendersOf(element, node));
        });
      }
    }
    ts.forEachChild(node, findEntries);
  };
  findEntries(sourceFile);

  return {
    functions,
    entries,
    boundaries: [...new Map(boundaries.map((one) => [one.key, one])).values()],
  };
}

/** The expressions in JSX braces (`{children}`) under `root`, not in another render function. */
function elementsInExpressions(
  root: ts.Node,
  functionNodes: ReadonlySet<ts.Node>,
  visit: (expression: ts.Expression) => void,
): void {
  const walk = (node: ts.Node): void => {
    if (node !== root && functionNodes.has(node)) return;
    if (ts.isJsxExpression(node) && node.expression !== undefined) visit(node.expression);
    ts.forEachChild(node, walk);
  };
  walk(root);
}

// ---- reading it back ----------------------------------------------------------------------------

function readAround(value: Json): Around | undefined {
  const f = fieldsOf(value);
  if (isString(f?.boundary)) return { boundary: f.boundary };
  return isString(f?.via) ? { via: f.via } : undefined;
}

function readRender(value: Json): TreeRender | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const around = each(f?.around, readAround);
  if (f === undefined || at === undefined || around === undefined) return undefined;
  if (typeof f.unknown !== "boolean") return undefined;
  return isString(f.target) && isString(f.name)
    ? { target: f.target, name: f.name, at, around, unknown: f.unknown }
    : undefined;
}

function readChain(value: Json | undefined): Chain | null | undefined {
  if (value === null) return null;
  const f = value === undefined ? undefined : fieldsOf(value);
  const at = spanOf(f?.at);
  const branches = each(f?.branches, (item): readonly string[] | null | undefined =>
    item === null ? null : readStrings(item),
  );
  if (f === undefined || at === undefined || branches === undefined) return undefined;
  if (!isString(f.file) || !isString(f.variable)) return undefined;
  if (f.dispatch !== "if" && f.dispatch !== "switch") return undefined;
  if (typeof f.exact !== "boolean" || typeof f.generic !== "boolean") return undefined;
  return {
    file: f.file,
    at,
    variable: f.variable,
    dispatch: f.dispatch,
    branches,
    exact: f.exact,
    generic: f.generic,
  };
}

function readFallback(value: Json): Fallback | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const kind = FALLBACK_KINDS.find((one) => one === f?.kind);
  const chain = readChain(f?.chain);
  if (f === undefined || at === undefined || kind === undefined || chain === undefined) {
    return undefined;
  }
  return isString(f.name) ? { kind, at, name: f.name, chain } : undefined;
}

function readBoundary(value: Json): BoundaryElement | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const fallbacks = each(f?.fallbacks, readFallback);
  if (f === undefined || at === undefined || fallbacks === undefined) return undefined;
  return isString(f.key) && isString(f.name)
    ? { key: f.key, name: f.name, at, fallbacks }
    : undefined;
}

const KINDS: readonly TreeFunction["kind"][] = ["component", "hook", "class"];

function readFunction(value: Json): TreeFunction | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  const kind = KINDS.find((one) => one === f?.kind);
  const renders = each(f?.renders, readRender);
  const hooks = readStrings(f?.hooks);
  const methods = readStrings(f?.methods);
  const effects = each(f?.effects, (item) => (typeof item === "number" ? item : undefined));
  const children = f?.children === null ? null : readStrings(f?.children);
  const guards = each(f?.guards, (item) => (typeof item === "number" ? item : undefined));
  if (f === undefined || at === undefined || kind === undefined || renders === undefined) {
    return undefined;
  }
  if (hooks === undefined || methods === undefined || effects === undefined) return undefined;
  if (children === undefined || guards === undefined) return undefined;
  if (!isString(f.id) || !isString(f.name)) return undefined;
  return { id: f.id, name: f.name, at, kind, renders, hooks, effects, methods, children, guards };
}

/** Read once per summary object: the engine hands out the same object while it is unchanged. */
const read = new WeakMap<object, TreeSummary | null>();

/** The tree as `summarizeTree` wrote it, or undefined for anything else (an old cache file). */
export function readTree(value: Json | undefined): TreeSummary | undefined {
  const f = value === undefined ? undefined : fieldsOf(value);
  if (f === undefined) return undefined;
  const known = read.get(f);
  if (known !== undefined) return known ?? undefined;
  const functions = each(f.functions, readFunction);
  const entries = each(f.entries, readRender);
  const boundaries = each(f.boundaries, readBoundary);
  const tree =
    functions === undefined || entries === undefined || boundaries === undefined
      ? undefined
      : { functions, entries, boundaries };
  read.set(f, tree ?? null);
  return tree;
}
