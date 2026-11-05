import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";
import {
  DEPENDENCY_HOOKS,
  calleeName,
  isReactCall,
  reactName,
  unwrapped,
  usesCompiler,
} from "./react.js";
import { shorten } from "./text.js";
import {
  MAX_PATH,
  RenderScope,
  isFunctionLike,
  renderFunctionOf,
  type CallSite,
  type Closure,
  type RenderFunction,
  summarisedFunction,
  type Fresh,
  type Site,
  type Value,
} from "./value.js";

type Place = { start: number; end: number };

/** What one position of a function's result holds, when it is not plainly stable. */
export type Origin =
  | {
      kind: "fresh";
      what: Fresh;
      at: Site;
      label: string | null;
      closure: Closure | null;
      derived: readonly string[];
    }
  | { kind: "from"; fn: string; path: string[]; except: string[]; call: CallSite }
  | { kind: "unknown"; text: string; at: Site };

export type Entry = { path: string[]; origin: Origin };

/**
 * A top-level function of the file and what its result holds, position by position. `hook`: it
 * is a hook (named `use…`, or it calls one), so a fix may wrap a value in a hook inside it.
 */
export type FunctionFact = { id: string; name: string; hook: boolean; returns: Entry[] };

/** Where a value is used so that a new one each render costs something. */
export type Target =
  { kind: "hook"; hook: string } | { kind: "memo-prop"; component: string; prop: string };

/** A dependency (or memo prop) whose value comes from a function of the project. */
export type Dependency = {
  at: Place;
  /** The dependency as written: `onSave`, `cart.onSave`. */
  text: string;
  /** The function it is in: `CartPage`. */
  in: string;
  target: Target;
  /** The function with this dependency calls it in this file (`onSkip()`), so project code is its caller. */
  called: boolean;
  via:
    | { kind: "from"; fn: string; path: string[]; source: string; call: CallSite }
    | { kind: "unknown"; source: string };
};

export type FileSummary = {
  /** The project uses the React Compiler: values are memoized for it, nothing is reported. */
  compiled: boolean;
  functions: FunctionFact[];
  dependencies: Dependency[];
};

/** The return expressions of a function, without those of functions nested in it. */
function returnsOf(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): ts.Expression[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [body];
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined) found.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** The positions of a value that are not plainly stable, as entries. */
function flatten(value: Value, path: string[], into: Entry[]): void {
  switch (value.kind) {
    case "stable":
    case "external":
      return;
    case "unknown":
      into.push({ path, origin: { kind: "unknown", text: value.text, at: value.at } });
      return;
    case "from":
      into.push({
        path,
        origin: {
          kind: "from",
          fn: value.fn,
          path: [...value.path],
          except: [...value.except],
          call: value.call,
        },
      });
      return;
    case "fresh": {
      into.push({
        path,
        origin: {
          kind: "fresh",
          what: value.what,
          at: value.at,
          label: value.label,
          closure: value.closure,
          derived: value.derived,
        },
      });
      if (path.length >= MAX_PATH) return;
      for (const spread of value.spreads) {
        const inner = spread.value;
        if (inner.kind === "from") {
          into.push({
            path,
            origin: {
              kind: "from",
              fn: inner.fn,
              path: [...inner.path],
              except: [...new Set([...inner.except, ...spread.except])],
              call: inner.call,
            },
          });
        } else if (inner.kind === "fresh") {
          for (const [key, member] of inner.members) {
            if (!spread.except.includes(key)) flatten(member, [...path, key], into);
          }
        }
      }
      for (const [key, member] of value.members) flatten(member, [...path, key], into);
      return;
    }
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** The name of a hook: `useCart`. */
const HOOK_NAME = /^use[A-Z0-9]/;

/** Whether a function calls a hook in its own body (not in a function nested in it). */
function callsHook(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (ts.isIdentifier(name) && (HOOK_NAME.test(name.text) || name.text === "use")) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return found;
}

/** Entries with the same text once, in first-seen order. */
function distinct(entries: readonly Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The name a render function goes by in messages: `CartPage`, or "this component". */
function functionName(fn: ts.Node): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name !== undefined) {
    return fn.name.text;
  }
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isCallExpression(parent)) return functionName(parent);
  return "this component";
}

/**
 * Whether a JSX tag is a component wrapped in React's `memo` in the project. One given its own
 * comparison (`memo(Row, compare)`) is not: the comparison decides which props count, and it may
 * well ignore a function prop.
 */
function isMemoComponent(ctx: FileContext, tag: ts.JsxTagNameExpression): string | undefined {
  if (!ts.isIdentifier(tag)) return undefined;
  const symbol = ctx.types.symbolAt(tag);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (symbol === undefined || declaration === undefined) return undefined;
  const node = declaration.node;
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return undefined;
  const init = unwrapped(node.initializer);
  return ts.isCallExpression(init) &&
    init.arguments.length === 1 &&
    isReactCall(ctx.types, init, "memo")
    ? symbol.id
    : undefined;
}

/** Whether `fn` calls the expression written as `text` (`onSkip()` for `onSkip`). */
function isCalledIn(fn: ts.Node, text: string, sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && unwrapped(node.expression).getText(sourceFile) === text)
      found = true;
    else ts.forEachChild(node, visit);
  };
  visit(fn);
  return found;
}

/** What a dependency's value is, when it is worth recording. */
function viaOf(value: Value): Dependency["via"] | undefined {
  if (value.kind === "from") {
    return {
      kind: "from",
      fn: value.fn,
      path: [...value.path],
      source: value.source,
      call: value.call,
    };
  }
  if (value.kind === "unknown" && value.hook) return { kind: "unknown", source: value.text };
  return undefined;
}

/**
 * `stableHooks`: the config's hooks (names or globs) whose every value is the same each render;
 * `stableFunctions`: its memoized functions, whose value is the same for the same arguments.
 */
export function summarizeFile(
  ctx: FileContext,
  stableHooks: readonly string[] = [],
  stableFunctions: readonly string[] = [],
): FileSummary {
  const { sourceFile, types } = ctx;
  const scopes = new Map<ts.Node, RenderScope>();
  const scopeOf = (fn: RenderFunction): RenderScope => {
    let scope = scopes.get(fn);
    if (scope === undefined) {
      scope = new RenderScope(types, sourceFile, fn, stableHooks, stableFunctions);
      scopes.set(fn, scope);
    }
    return scope;
  };
  const place = (node: ts.Node): Place => ({ start: node.getStart(sourceFile), end: node.end });

  const functions: FunctionFact[] = [];
  const declarations: ts.Node[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) declarations.push(statement);
    if (ts.isVariableStatement(statement))
      declarations.push(...statement.declarationList.declarations);
  }
  for (const declaration of declarations) {
    const found = summarisedFunction(declaration);
    if (found === undefined) continue;
    const id = types.symbolAt(found.name)?.id;
    if (id === undefined) continue;
    const scope = scopeOf(found.fn);
    const entries: Entry[] = [];
    for (const expression of returnsOf(found.fn)) flatten(scope.valueOf(expression), [], entries);
    if (entries.length > 0)
      functions.push({
        id,
        name: found.name.text,
        hook: HOOK_NAME.test(found.name.text) || callsHook(found.fn),
        returns: distinct(entries),
      });
  }

  const dependencies: Dependency[] = [];
  const record = (expression: ts.Expression, target: Target): void => {
    const fn = renderFunctionOf(expression);
    if (fn === undefined) return;
    const via = viaOf(scopeOf(fn).valueOf(expression));
    if (via === undefined) return;
    const text = unwrapped(expression).getText(sourceFile);
    dependencies.push({
      called: isCalledIn(fn, text, sourceFile),
      at: place(expression),
      text: shorten(unwrapped(expression).getText(sourceFile), 30),
      in: functionName(fn),
      target,
      via,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const deps = node.arguments[1];
      const hook = deps === undefined ? undefined : reactName(types, calleeName(node.expression));
      if (hook !== undefined && DEPENDENCY_HOOKS.has(hook) && deps !== undefined) {
        const list = unwrapped(deps);
        if (ts.isArrayLiteralExpression(list)) {
          for (const element of list.elements) {
            if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) continue;
            record(element, { kind: "hook", hook });
          }
        }
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = isMemoComponent(ctx, node.tagName);
      if (component !== undefined) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
          const init = attribute.initializer;
          if (init === undefined || !ts.isJsxExpression(init) || init.expression === undefined)
            continue;
          record(init.expression, {
            kind: "memo-prop",
            component: node.tagName.getText(sourceFile),
            prop: attribute.name.text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { compiled: usesCompiler(types, ctx.file), functions, dependencies };
}
