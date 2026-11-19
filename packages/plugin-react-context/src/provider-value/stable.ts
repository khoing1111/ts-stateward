/**
 * Whether a Provider's value never changes, for a context stated `Stable`: what the value is
 * built from must keep its identity for the life of the component. A setter or `dispatch`, a ref,
 * a module constant, a module `let` nothing assigns again, state whose setter is never read, and
 * `useMemo`/`useCallback` whose dependencies are all of those qualify; other state, props, the
 * result of a hook of the project and new objects do not.
 *
 * Every value a `useMemo`/`useCallback` body is built from is listed and read: the names it reads
 * directly, through local helper functions it calls, through named callbacks and builders
 * (`useCallback(handler, [])`, `useMemo(build, [])`), and through the object literals and nested
 * closures inside them. A value that can change and is not in the dependency list is "not
 * proven"; anything else the proof cannot read is "not checked" (`Outcome.unchecked`), never
 * proven.
 */
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import { packageHookValue } from "./packages.js";
import { calleeName, reactName, unwrapped } from "./react.js";
import { isFunctionLike, localDeclaration, renderFunctionOf } from "./value.js";
import type { RenderFunction } from "./value.js";

/** The guarantee a context states when its type has `Stable`. */
export const STABLE = "stable";

/** Why a value is not proven stable, and the node that shows it. */
export type Unstable =
  | {
      kind: "fresh";
      what: "object" | "array" | "function" | "instance";
      /** The values that can change which the literal reads, so a `useMemo` over them would be stale. */
      reads: readonly Read[];
      node: ts.Node;
    }
  /** A `useMemo`/`useCallback` reads a value that can change and does not list it: it keeps the first. */
  | { kind: "stale"; hook: "useMemo" | "useCallback"; read: Read; node: ts.Node }
  | { kind: "changes"; name: string; why: Why; node: ts.Node }
  | { kind: "no-dependencies"; hook: string; node: ts.Node };

/** What a name the value depends on is, when it can change. */
export type Why = "state" | "prop" | "let" | "assigned" | "ref" | "context" | "value" | "hook";

/**
 * A name read by a value, and why it can change. `via` is the local helper, callback or object
 * the read is made through (`helper` in `const helper = () => onSave(user)`), when it is not
 * written in the value itself.
 */
export type Read = { name: string; why: Why; via?: string };

/** What to write instead of a value that is not followed, for a context stated `Stable`. */
const STABLE_FIX =
  "build the value in the Provider's component with `useState`, `useMemo` or `useCallback`, from values that never change";

/** A place the proof cannot read: what is there, as `not checked: …` says it. */
export type Unchecked = { reason: string; node: ts.Node };

/**
 * What reading a value found: the first reason it may change (`why`), and every place that could
 * not be read (`unchecked`). A value with neither is proven.
 */
export type Outcome = { why: Unstable | undefined; unchecked: readonly Unchecked[] };

/** Hooks whose tuple has a stable member at this index: the setter or `dispatch`. */
const STABLE_MEMBER: ReadonlyMap<string, number> = new Map([
  ["useState", 1],
  ["useReducer", 1],
  ["useActionState", 1],
  ["useTransition", 1],
  ["useOptimistic", 1],
]);

/**
 * Hooks whose state changes only through the member at `STABLE_MEMBER`: with that member never
 * taken, the state keeps its first value. Not `useOptimistic` (it follows its first argument) or
 * `useActionState` and `useTransition` (React sets them while an action runs).
 */
const SET_ONLY_BY_MEMBER: ReadonlySet<string> = new Set(["useState", "useReducer"]);

/** Hooks whose whole result keeps its identity. */
const STABLE_RESULT: ReadonlySet<string> = new Set(["useRef", "useId"]);

const MAX_DEPTH = 8;

/** Whether a name is a hook's (`useCounter`). */
function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

/** The assignment operators: a name written with one of them is assigned again. */
const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether a name is written to where it stands: `x = …`, `x += …`, `x++`, `[x] = …`, `for (x of …)`. */
function isWrittenTo(name: ts.Identifier | ts.PropertyAccessExpression): boolean {
  let child: ts.Node = name;
  let parent: ts.Node = name.parent;
  for (;;) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === child)
    ) {
      child = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isBinaryExpression(parent)) {
      // `[a = 1] = list`: the default's name is a target too; a right-hand side is a read.
      return parent.left === child && ASSIGNMENTS.has(parent.operatorToken.kind);
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      return (
        parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken
      );
    }
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      return parent.initializer === child;
    }
    return false;
  }
}

/**
 * Reads one render function's values. `compiled`: the React Compiler memoizes a literal by what
 * it reads, so a literal is stable when everything it reads is.
 */
export class StableScope {
  /** The places the current `check` could not read. */
  private unchecked: Unchecked[] = [];

  constructor(
    private readonly types: TypeQueries,
    private readonly fn: RenderFunction,
    private readonly compiled: boolean,
  ) {}

  /**
   * Whether the value never changes: the first reason it may (a finding), and every place that
   * could not be read (the guarantee reads "not checked" while one is left).
   */
  check(expression: ts.Expression): Outcome {
    const outer = this.unchecked;
    this.unchecked = [];
    const why = this.value(expression, 0);
    const unchecked = this.unchecked;
    this.unchecked = outer;
    return { why, unchecked };
  }

  /**
   * Notes a place the proof cannot read, once, and reads as "nothing found here": `reason` says
   * what is there, `fix` what to write instead.
   */
  private cannot(node: ts.Node, what: string, fix: string = STABLE_FIX): Unstable | undefined {
    const reason = fix === "" ? what : `${what}: ${fix}`;
    if (!this.unchecked.some((one) => one.node === node && one.reason === reason)) {
      this.unchecked.push({ reason, node });
    }
    return undefined;
  }

  /** Undefined when the value never changes; otherwise the first reason it may. */
  private value(expression: ts.Expression, depth: number): Unstable | undefined {
    if (depth > MAX_DEPTH) {
      return this.cannot(
        expression,
        `\`${short(expression)}\` is too deeply nested for stateward to follow`,
      );
    }
    const node = unwrapped(expression);
    if (isConstantLiteral(node)) return undefined;
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isNewExpression(node)
    ) {
      if (this.compiled) return this.compiledReads(node, depth);
      return { kind: "fresh", what: kindOf(node), reads: this.reading(node, depth).changing, node };
    }
    if (ts.isConditionalExpression(node)) {
      return (
        this.value(node.condition, depth + 1) ??
        this.value(node.whenTrue, depth + 1) ??
        this.value(node.whenFalse, depth + 1)
      );
    }
    if (ts.isBinaryExpression(node)) {
      return this.value(node.left, depth + 1) ?? this.value(node.right, depth + 1);
    }
    if (ts.isIdentifier(node)) return this.identifier(node, depth);
    if (ts.isPropertyAccessExpression(node)) {
      const base = this.value(node.expression, depth + 1);
      if (base !== undefined) return base;
      // `holder.current` of a module `const` whose file assigns `holder.current = …`.
      const assigned = this.assignedProperty(node);
      if (assigned !== undefined) {
        return { kind: "changes", name: short(assigned), why: "assigned", node };
      }
      const doubt = this.holderDoubt(node);
      // The doubt says what to write instead.
      if (doubt !== undefined) return this.cannot(node, doubt, "");
      // `ref.current` is what the ref holds now, and it is meant to change.
      return node.name.text === "current" && this.isRef(node.expression)
        ? { kind: "changes", name: short(node), why: "ref", node }
        : undefined;
    }
    if (ts.isElementAccessExpression(node)) {
      return (
        this.value(node.expression, depth + 1) ?? this.value(node.argumentExpression, depth + 1)
      );
    }
    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        const found = this.value(span.expression, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) return undefined;
    if (ts.isCallExpression(node)) return this.call(node, depth);
    return this.cannot(node, `where \`${short(node)}\` comes from is not followed`);
  }

  /** A literal under the React Compiler: stable when every name it reads from the function is. */
  private compiledReads(node: ts.Node, depth: number): Unstable | undefined {
    let found: Unstable | undefined;
    const visit = (child: ts.Node): void => {
      if (found !== undefined) return;
      if (ts.isIdentifier(child) && isReference(child)) {
        const declaration = this.declarationOf(child);
        if (declaration !== undefined && this.isLocal(declaration) && !within(declaration, node)) {
          found = this.identifier(child, depth + 1);
          return;
        }
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    return found;
  }

  /**
   * Every value the node is built from that can change, once each, in source order. The names
   * it reads directly are listed, and what the local functions, callbacks and objects it reads
   * read in turn (`via` says through which): `const helper = () => onSave(user)` read by a memo
   * is a read of `onSave` and `user`. A read that cannot be followed is noted as unchecked.
   */
  private reading(root: ts.Node, depth: number): { changing: Read[] } {
    const changing: Read[] = [];
    const seen = new Set<ts.Node>();
    const through = (via: string | undefined): { via?: string } =>
      via === undefined ? {} : { via };
    const add = (read: Read): void => {
      if (!changing.some((one) => one.name === read.name)) changing.push(read);
    };
    /** A value that is not proven stable, read under `name`. */
    const asRead = (name: string, found: Unstable | undefined, via: string | undefined): void => {
      if (found === undefined) return;
      const why: Why =
        found.kind === "changes" && (found.name === name || found.why === "hook")
          ? found.why
          : "value";
      add({ name, why, ...through(via) });
    };

    const walk = (region: ts.Node, via: string | undefined, level: number): void => {
      const visit = (child: ts.Node): void => {
        if (ts.isIdentifier(child) && isReference(child)) read(child, region, via, level);
        ts.forEachChild(child, visit);
      };
      visit(region);
    };

    const read = (
      id: ts.Identifier,
      region: ts.Node,
      via: string | undefined,
      level: number,
    ): void => {
      if (id.text === "undefined") return;
      const declaration = this.declarationOf(id);
      if (declaration === undefined || within(declaration, region)) return;
      if (!this.isLocal(declaration)) {
        // A module-level name: the same value for ever, unless a `let` that is assigned again,
        // or a property of it that its file assigns (`holder.current = …`).
        if (this.isReassignedLet(declaration)) add({ name: id.text, why: "let", ...through(via) });
        let access: ts.Node = id;
        while (
          ts.isPropertyAccessExpression(access.parent) &&
          access.parent.expression === access
        ) {
          access = access.parent;
        }
        const assigned = ts.isPropertyAccessExpression(access)
          ? this.assignedProperty(access)
          : undefined;
        if (assigned !== undefined) {
          add({ name: short(assigned), why: "assigned", ...through(via) });
        } else if (ts.isPropertyAccessExpression(access)) {
          const doubt = this.holderDoubt(access);
          if (doubt !== undefined) this.cannot(access, doubt, "");
        }
        return;
      }
      if (seen.has(declaration)) return;
      if (level > MAX_DEPTH) {
        this.cannot(
          id,
          `\`${id.text}\` is read through too many helpers for stateward to follow`,
          "read it directly in the Provider's component",
        );
        return;
      }
      if (ts.isParameter(declaration)) {
        const why = within(declaration, this.fn.parameters) ? "prop" : "value";
        add({ name: id.text, why, ...through(via) });
        return;
      }
      if (ts.isBindingElement(declaration)) {
        asRead(id.text, this.binding(declaration, id, depth + 1), via);
        return;
      }
      if (ts.isFunctionDeclaration(declaration)) {
        seen.add(declaration);
        walk(declaration, via ?? id.text, level + 1);
        return;
      }
      if (!ts.isVariableDeclaration(declaration)) {
        this.cannot(id, `where \`${id.text}\` comes from is not followed`);
        return;
      }
      if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) {
        add({ name: id.text, why: "let", ...through(via) });
        return;
      }
      if (declaration.initializer === undefined) return;
      seen.add(declaration);
      const init = unwrapped(declaration.initializer);
      if (
        ts.isArrowFunction(init) ||
        ts.isFunctionExpression(init) ||
        ts.isObjectLiteralExpression(init) ||
        ts.isArrayLiteralExpression(init) ||
        ts.isNewExpression(init)
      ) {
        walk(init, via ?? id.text, level + 1);
        return;
      }
      if (ts.isCallExpression(init)) {
        asRead(id.text, this.call(init, depth + 1), via);
        // The arguments of a call to a plain function are read too: `makeHelper(onSave)`.
        const callee = calleeName(init.expression);
        if (reactName(this.types, callee) === undefined && !isHookName(callee.getText())) {
          for (const argument of init.arguments) walk(argument, via ?? id.text, level + 1);
        }
        return;
      }
      // `const f = ref.current`: a copy of what a ref holds now, which is meant to change.
      if (ts.isPropertyAccessExpression(init)) asRead(id.text, this.value(init, depth + 1), via);
      walk(init, via ?? id.text, level + 1);
      // A call inside what the name is built from has a result that cannot be read.
      const visitCalls = (child: ts.Node): void => {
        if (isFunctionLike(child)) return;
        if (ts.isCallExpression(child)) asRead(id.text, this.call(child, depth + 1), via);
        ts.forEachChild(child, visitCalls);
      };
      visitCalls(init);
    };

    walk(root, undefined, 0);
    return { changing };
  }

  private identifier(node: ts.Identifier, depth: number): Unstable | undefined {
    if (node.text === "undefined") return undefined;
    const declaration = this.declarationOf(node);
    if (declaration === undefined) {
      return this.cannot(node, `where \`${node.text}\` comes from is not followed`);
    }
    if (!this.isLocal(declaration)) {
      return this.isReassignedLet(declaration)
        ? { kind: "changes", name: node.text, why: "let", node: declaration }
        : undefined;
    }
    if (ts.isParameter(declaration)) return { kind: "changes", name: node.text, why: "prop", node };
    if (ts.isBindingElement(declaration)) return this.binding(declaration, node, depth);
    if (ts.isFunctionDeclaration(declaration)) {
      return this.compiled
        ? this.compiledReads(declaration, depth)
        : {
            kind: "fresh",
            what: "function",
            reads: this.reading(declaration, depth).changing,
            node: declaration,
          };
    }
    if (ts.isVariableDeclaration(declaration)) {
      if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) {
        return { kind: "changes", name: node.text, why: "let", node: declaration };
      }
      return declaration.initializer === undefined
        ? undefined
        : this.value(declaration.initializer, depth + 1);
    }
    return this.cannot(node, `where \`${node.text}\` comes from is not followed`);
  }

  /** `const [state, setState] = useState(…)`, `const { a } = props`. */
  private binding(
    element: ts.BindingElement,
    node: ts.Identifier,
    depth: number,
  ): Unstable | undefined {
    const pattern = element.parent;
    const holder = pattern.parent;
    if (ts.isParameter(holder) || within(holder, this.fn.parameters)) {
      return { kind: "changes", name: node.text, why: "prop", node };
    }
    if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) {
      return this.cannot(node, `where \`${node.text}\` comes from is not followed`);
    }
    const init = unwrapped(holder.initializer);
    if (ts.isCallExpression(init) && ts.isArrayBindingPattern(pattern)) {
      const hook = reactName(this.types, calleeName(init.expression));
      const stable = hook === undefined ? undefined : STABLE_MEMBER.get(hook);
      if (stable !== undefined) {
        const index = pattern.elements.indexOf(element);
        if (index === stable) return undefined;
        // State that nothing can set keeps its first value: `const [store] = useState(createStore)`.
        if (index === 0 && SET_ONLY_BY_MEMBER.has(hook ?? "") && !this.isTaken(pattern, stable)) {
          return undefined;
        }
        return { kind: "changes", name: node.text, why: "state", node: element };
      }
    }
    // `const { dispatch } = store`: a member of a value that never changes is the same member.
    return ts.isIdentifier(init) && ts.isObjectBindingPattern(pattern)
      ? this.value(init, depth + 1)
      : { kind: "changes", name: node.text, why: "value", node: element };
  }

  private call(node: ts.CallExpression, depth: number): Unstable | undefined {
    const callee = calleeName(node.expression);
    const hook = reactName(this.types, callee);
    if (hook === "useMemo" || hook === "useCallback") return this.memo(node, hook, depth);
    if (hook !== undefined && STABLE_RESULT.has(hook)) return undefined;
    if (hook === "useContext" || hook === "use") {
      const context = node.arguments[0];
      return context !== undefined && this.types.guaranteesOf(context).includes(STABLE)
        ? undefined
        : { kind: "changes", name: short(node), why: "context", node };
    }
    if (hook === undefined) {
      const symbol = this.types.symbolAt(callee);
      const declaration = symbol === undefined ? undefined : this.types.declarationOf(symbol);
      const owner = declaration === undefined ? undefined : this.types.packageOf(declaration.file);
      if (
        symbol !== undefined &&
        owner !== undefined &&
        packageHookValue(owner, symbol.name) === "stable"
      ) {
        return undefined;
      }
      // A hook of the project: what it returns can change, and nothing here says it does not.
      if (isHookName(callee.getText())) {
        return { kind: "changes", name: short(node), why: "hook", node };
      }
    }
    return this.cannot(node, `\`${short(node)}\` is a call whose result is not followed`);
  }

  /**
   * `useMemo`/`useCallback`: stable when the dependencies are, and the list names every value
   * the callback reads that can change, however it reads it.
   */
  private memo(
    node: ts.CallExpression,
    hook: "useMemo" | "useCallback",
    depth: number,
  ): Unstable | undefined {
    const dependencies = node.arguments[1];
    if (dependencies === undefined) return { kind: "no-dependencies", hook, node };
    const list = unwrapped(dependencies);
    if (!ts.isArrayLiteralExpression(list)) {
      return this.cannot(
        dependencies,
        `the dependency list \`${short(dependencies)}\` of the \`${hook}\` is not an array written in place`,
        "write the list in place, as `[a, b]`",
      );
    }
    for (const element of list.elements) {
      const found = this.value(element, depth + 1);
      if (found !== undefined) return found;
    }
    // The proof trusts the list only when it covers what the callback reads.
    const given = node.arguments[0];
    if (given === undefined) return undefined;
    const callback = this.callbackOf(given);
    if (callback === undefined) {
      return this.cannot(
        given,
        `the callback \`${short(given)}\` of the \`${hook}\` is not a function written in place`,
        "give it an arrow function written in place",
      );
    }
    const listed = new Set(list.elements.map((element) => rootName(element)));
    const missing = this.reading(callback, depth).changing.find((one) => !listed.has(one.name));
    return missing === undefined
      ? undefined
      : { kind: "stale", hook, read: missing, node: callback };
  }

  /**
   * The function a memo hook runs: written in place, or named (`useCallback(handler, [])`,
   * `useMemo(build, [])`: a function declaration or a `const` holding a function). A function
   * from another module is the same for ever and reads nothing of this component, so it is its
   * own callback; any other expression is undefined.
   */
  private callbackOf(given: ts.Expression): ts.Node | undefined {
    const callback = unwrapped(given);
    if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) return callback;
    if (!ts.isIdentifier(callback)) return undefined;
    const declaration = this.declarationOf(callback);
    if (declaration === undefined) return undefined;
    if (!this.isLocal(declaration)) return callback;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
    const init =
      ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
        ? unwrapped(declaration.initializer)
        : undefined;
    return init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
      ? init
      : undefined;
  }

  /**
   * The part of a property chain on a module-level name that its file assigns again
   * (`holder.current` of `holder.current.save`, when the file has `holder.current = …`), or
   * undefined when the file assigns none of it.
   */
  private assignedProperty(access: ts.PropertyAccessExpression): ts.Expression | undefined {
    const parts: ts.PropertyAccessExpression[] = [];
    let root: ts.Expression = access;
    while (ts.isPropertyAccessExpression(root)) {
      parts.unshift(root);
      root = root.expression;
    }
    if (!ts.isIdentifier(root)) return undefined;
    const declaration = this.declarationOf(root);
    if (declaration === undefined || this.isLocal(declaration)) return undefined;
    const symbol = this.types.symbolAt(root);
    if (symbol === undefined) return undefined;
    const texts = new Set(parts.map((part) => part.getText().replace(/\s+/g, "")));
    let found: string | undefined;
    const visit = (child: ts.Node): void => {
      if (found !== undefined) return;
      if (ts.isPropertyAccessExpression(child) && isWrittenTo(child)) {
        let start: ts.Expression = child;
        while (ts.isPropertyAccessExpression(start)) start = start.expression;
        const text = child.getText().replace(/\s+/g, "");
        if (
          texts.has(text) &&
          ts.isIdentifier(start) &&
          this.types.symbolAt(start)?.id === symbol.id
        ) {
          found = text;
          return;
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(access.getSourceFile());
    return parts.find((part) => part.getText().replace(/\s+/g, "") === found);
  }

  /**
   * Why a property of a module-level holder (`holder.current`, `store.actions`) may be written
   * where the proof does not look, or undefined when every write to it is in this file and read
   * (`assignedProperty`). A closed list is read: a `readonly` property; a property of a `const`
   * object written in place in this file, not exported, and used only through its properties; a
   * namespace import. Anything else (another file's holder, a class instance, the holder given
   * whole to a call or another name) is not checked.
   */
  private holderDoubt(access: ts.PropertyAccessExpression): string | undefined {
    if (this.types.isReadonlyPath(access)) return undefined;
    let root: ts.Expression = access;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    if (!ts.isIdentifier(root)) return undefined;
    const declaration = this.declarationOf(root);
    if (declaration === undefined || this.isLocal(declaration)) return undefined;
    // A namespace import: its properties are the module's exports, which no code here writes.
    if (ts.isSourceFile(declaration) || ts.isModuleDeclaration(declaration)) return undefined;
    // A library's value (`console.log`) is not a holder of the project.
    if (
      !ts.isVariableDeclaration(declaration) ||
      !this.types.isOwnFile(declaration.getSourceFile().fileName)
    ) {
      return undefined;
    }
    const shown = short(access);
    const name = root.text;
    if (declaration.getSourceFile() !== access.getSourceFile()) {
      return `\`${shown}\` is a property of \`${name}\`, which another file declares and may write: make the property \`readonly\`, or declare \`${name}\` here as a \`const\` object written in place, not exported`;
    }
    const statement = declaration.parent.parent;
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword) === true
    ) {
      return `\`${shown}\` is a property of \`${name}\`, which is exported, so another file may write it: make the property \`readonly\`, or declare \`${name}\` here as a \`const\` object written in place, not exported`;
    }
    const init = declaration.initializer && unwrapped(declaration.initializer);
    if (init === undefined || !ts.isObjectLiteralExpression(init)) {
      return `\`${shown}\` is a property of \`${name}\`, which is not an object written in place, so its own methods may write it: make the property \`readonly\`, or declare \`${name}\` here as a \`const\` object written in place, not exported`;
    }
    const symbol = this.types.symbolAt(root);
    let whole: ts.Node | undefined;
    const visit = (child: ts.Node): void => {
      if (whole !== undefined) return;
      if (
        ts.isIdentifier(child) &&
        child !== declaration.name &&
        child.text === name &&
        !(ts.isPropertyAccessExpression(child.parent) && child.parent.expression === child) &&
        this.types.symbolAt(child)?.id === symbol?.id
      ) {
        whole = child;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(access.getSourceFile());
    return whole === undefined
      ? undefined
      : `\`${shown}\` is a property of \`${name}\`, which \`${short(whole.parent)}\` uses whole, where stateward does not follow a write to it: use \`${name}\` only through its properties`;
  }

  /** Whether a declaration is a module-level `let` or `var` that something assigns again. */
  private isReassignedLet(declaration: ts.Node): boolean {
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
    if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0) return false;
    const name = declaration.name;
    const symbol = this.types.symbolAt(name);
    if (symbol === undefined) return true;
    let assigned = false;
    const visit = (child: ts.Node): void => {
      if (assigned) return;
      if (
        ts.isIdentifier(child) &&
        child.text === name.text &&
        child !== name &&
        isWrittenTo(child) &&
        this.types.symbolAt(child)?.id === symbol.id
      ) {
        assigned = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(declaration.getSourceFile());
    return assigned;
  }

  /**
   * Whether the tuple member at `index` is bound and read anywhere in the render function. A
   * read is any identifier with the binding's name, so a shadowing name counts as a read: the
   * state is then reported, never missed.
   */
  private isTaken(pattern: ts.ArrayBindingPattern, index: number): boolean {
    if (
      pattern.elements.some((element) => ts.isBindingElement(element) && element.dotDotDotToken)
    ) {
      return true;
    }
    const member = pattern.elements[index];
    if (member === undefined || ts.isOmittedExpression(member)) return false;
    if (!ts.isIdentifier(member.name)) return true;
    const name = member.name;
    let read = false;
    const visit = (child: ts.Node): void => {
      if (read) return;
      if (
        ts.isIdentifier(child) &&
        child !== name &&
        child.text === name.text &&
        isReference(child)
      ) {
        read = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(this.fn, visit);
    return read;
  }

  /** Whether an expression is a `useRef(…)` value of this function. */
  private isRef(expression: ts.Expression): boolean {
    const node = unwrapped(expression);
    if (!ts.isIdentifier(node)) return false;
    const declaration = this.declarationOf(node);
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
    const init = declaration.initializer && unwrapped(declaration.initializer);
    return (
      init !== undefined &&
      ts.isCallExpression(init) &&
      reactName(this.types, calleeName(init.expression)) === "useRef"
    );
  }

  private declarationOf(node: ts.Identifier): ts.Node | undefined {
    // The name of a shorthand property (`{ user }`) is the property's own declaration for the
    // type checker, so the variable it reads is found by scope; none here is a module-level name.
    if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
      return localDeclaration(node.text, node, this.fn) ?? node.getSourceFile();
    }
    const symbol = this.types.symbolAt(node);
    return symbol === undefined ? undefined : this.types.declarationOf(symbol)?.node;
  }

  private isLocal(node: ts.Node): boolean {
    return (
      node.getSourceFile() === this.fn.getSourceFile() &&
      node.pos >= this.fn.pos &&
      node.end <= this.fn.end
    );
  }
}

/** The `value` attribute of a Provider's tag, and whether a spread could give it instead. */
export function valueAttributeOf(opening: ts.JsxOpeningLikeElement): {
  attribute: ts.JsxAttribute | undefined;
  spread: boolean;
} {
  const properties = opening.attributes.properties;
  return {
    attribute: properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "value",
    ),
    spread: properties.some((property) => ts.isJsxSpreadAttribute(property)),
  };
}

/**
 * The places the proof cannot read in a Provider of a context stated `Stable`: the value as the
 * rule reads it (`StableScope.check`), a `value` given through a spread, and a Provider outside
 * any component. Each reads "not checked" in the guarantee.
 */
export function uncheckedAt(
  types: TypeQueries,
  compiled: boolean,
  opening: ts.JsxOpeningLikeElement,
): Unchecked[] {
  const { attribute, spread } = valueAttributeOf(opening);
  if (attribute === undefined) {
    return spread
      ? [
          {
            node: opening,
            reason:
              "its `value` may be given through a spread of props: write `value={…}` on the Provider itself",
          },
        ]
      : [];
  }
  const init = attribute.initializer;
  if (init === undefined || !ts.isJsxExpression(init) || init.expression === undefined) return [];
  const fn = renderFunctionOf(opening);
  if (fn === undefined) {
    return [
      {
        node: init.expression,
        reason:
          "its `value` is written outside a component: render the Provider in a component, and build the value there with `useState` or `useMemo`",
      },
    ];
  }
  return [...new StableScope(types, fn, compiled).check(init.expression).unchecked];
}

/** The name a dependency starts at: `user` for `user` and `user.id`. */
function rootName(node: ts.Expression): string | undefined {
  const inner = unwrapped(node);
  if (ts.isIdentifier(inner)) return inner.text;
  if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) {
    return rootName(inner.expression);
  }
  return undefined;
}

function within(node: ts.Node, outer: ts.Node | ts.NodeArray<ts.Node>): boolean {
  return node.pos >= outer.pos && node.end <= outer.end;
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== node;
  if (ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) return parent.name !== node;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  if (ts.isParameter(parent) || ts.isBindingElement(parent)) return parent.name !== node;
  return true;
}

function isConstantLiteral(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

function kindOf(node: ts.Node): "object" | "array" | "function" | "instance" {
  if (ts.isObjectLiteralExpression(node)) return "object";
  if (ts.isArrayLiteralExpression(node)) return "array";
  return ts.isNewExpression(node) ? "instance" : "function";
}

function short(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
