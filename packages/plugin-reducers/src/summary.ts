import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { shorten } from "./text.js";

export type Place = { start: number; end: number };

/**
 * One way a reducer changes state: from these states (`read` is false when nothing narrowed
 * them, so they are all of them) to these states, on this event when a `case` or `if` names it.
 */
export type Edge = Place & { from: string[]; read: boolean; to: string[]; event: string | null };

/** A return the graph cannot read: its type is the whole union, or no tag at all. */
/**
 * A return the graph cannot read. `constant`: it returns a constant (`return restored`) whose
 * initializer cannot be read either, so the fix is the constant's type, not a function's.
 */
export type Unreadable = Place & { kind: "whole" | "unknown"; text: string; constant: boolean };

/**
 * The states listed after `@final` or `@initial` as quoted literals, and where the tag is.
 * `prose` is true when the tag has text that does not start with a quoted literal: a comment.
 */
export type Names = { names: string[]; at: Place; prose: boolean };

export type Reducer = {
  /** The qualified id of the function. */
  id: string;
  name: string;
  /** The reducer's name. */
  at: Place;
  stateName: string;
  stateFile: string;
  /** The state type's name, where it is declared. */
  stateAt: Place;
  /** The property that tells the states apart: `status`. */
  tag: string;
  /** Every state, sorted. */
  tags: string[];
  /** Where each state is written in the state type, when it is written there. */
  tagAt: Record<string, Place>;
  final: Names | null;
  /** Where `@final` can take one more name: after its last name, or a new comment before the type. */
  finalFix: { at: number; create: boolean; separator: string } | null;
  /**
   * A `const …FINAL_STATES = […] as const satisfies readonly State["tag"][]` in the reducer's
   * module: the states it lists are final, TypeScript-checked. `add` is where one more name goes
   * and what comes before it.
   */
  finalConst: {
    name: string;
    names: string[];
    at: Place;
    add: { at: number; before: string };
  } | null;
  initial: Names | null;
  /** Exported from a package entry: code outside the project may call it. */
  external: boolean;
  edges: Edge[];
  unreadable: Unreadable[];
};

/** A `useReducer` call: the reducer's id, the states it starts in (null: any), and where. */
export type Use = { reducer: string; starts: string[] | null; at: Place };

/** A place where a reducer is called or handed on, other than `useReducer`'s first argument. */
export type Reference = { id: string; kind: "call" | "value"; at: Place };

export type FileSummary = { reducers: Reducer[]; uses: Use[]; references: Reference[] };

/** Whether a file is a test: `*.test.*`, `*.spec.*` or under `__tests__`. */
export function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.[^/]+$/.test(file) || /(?:^|\/)__tests__\//.test(file);
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** What the signature `(state: S, …): S` says about a function: its state type and tag. */
type Signature = {
  fn: FunctionNode;
  name: ts.Identifier;
  /** The statement the function's comment belongs to. */
  host: ts.Node;
  param: ts.Identifier;
  paramId: string;
  stateId: string;
  state: ts.TypeAliasDeclaration;
  stateFile: string;
  tag: string;
  tags: string[];
};

const place = (node: ts.Node, sourceFile: ts.SourceFile): Place => ({
  start: node.getStart(sourceFile),
  end: node.end,
});

function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The text of a string literal or a template without substitutions. */
function stringOf(expression: ts.Expression): string | undefined {
  const inner = unwrapped(expression);
  return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)
    ? inner.text
    : undefined;
}

/** A function a name stands for: `function f`, or `const f = () => …`. */
function functionOf(
  declaration: ts.Node,
): { fn: FunctionNode; name: ts.Identifier; host: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(declaration) && declaration.name !== undefined) {
    return declaration.body === undefined
      ? undefined
      : { fn: declaration, name: declaration.name, host: declaration };
  }
  if (
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.initializer !== undefined
  ) {
    const init = unwrapped(declaration.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return { fn: init, name: declaration.name, host: declaration.parent.parent };
    }
  }
  return undefined;
}

type Memo = {
  signatures: Map<ts.Node, Signature | null>;
  summaries: Map<string, FileSummary | undefined>;
};
const memos = new WeakMap<TypeQueries, Memo>();

function memoOf(types: TypeQueries): Memo {
  let memo = memos.get(types);
  if (memo === undefined) {
    memo = { signatures: new Map(), summaries: new Map() };
    memos.set(types, memo);
  }
  return memo;
}

/**
 * Whether a function is shaped like a reducer: its first parameter is a state type (a type alias
 * of a union with exactly one tag) and it returns that same type, declared or inferred.
 */
function signatureOf(
  found: { fn: FunctionNode; name: ts.Identifier; host: ts.Node },
  types: TypeQueries,
): Signature | undefined {
  const memo = memoOf(types).signatures;
  const known = memo.get(found.fn);
  if (known !== undefined) return known ?? undefined;
  const result = readSignature(found, types);
  memo.set(found.fn, result ?? null);
  return result;
}

function readSignature(
  found: { fn: FunctionNode; name: ts.Identifier; host: ts.Node },
  types: TypeQueries,
): Signature | undefined {
  const { fn } = found;
  const first = fn.parameters[0];
  if (first === undefined || !ts.isIdentifier(first.name)) return undefined;
  const written = first.type;
  if (written === undefined || !ts.isTypeReferenceNode(written) || written.typeArguments) {
    return undefined;
  }
  if (!ts.isIdentifier(written.typeName)) return undefined;
  const stateSymbol = types.symbolAt(written.typeName);
  const declared = stateSymbol && types.declarationOf(stateSymbol);
  if (stateSymbol === undefined || declared === undefined) return undefined;
  const state = declared.node;
  if (!ts.isTypeAliasDeclaration(state) || state.typeParameters !== undefined) return undefined;
  if (!types.isOwnFile(declared.file)) return undefined;
  if (fn.type !== undefined) {
    const returned = fn.type;
    if (!ts.isTypeReferenceNode(returned) || !ts.isIdentifier(returned.typeName)) return undefined;
    if (types.symbolAt(returned.typeName)?.id !== stateSymbol.id) return undefined;
  } else {
    const alias = types.returnAliasOf(fn);
    if (
      alias === undefined ||
      alias.promised ||
      alias.name !== state.name.text ||
      alias.file !== declared.file
    ) {
      return undefined;
    }
  }
  const [tag, ...more] = types.discriminantsOf(first.name);
  if (tag === undefined || more.length > 0) return undefined;
  const found2 = types.tagsOf(first.name, tag);
  if (found2 === "not-finite") return undefined;
  const tags: string[] = [];
  for (const literal of found2) {
    if (typeof literal.value !== "string") return undefined;
    tags.push(literal.value);
  }
  const paramId = types.symbolAt(first.name)?.id;
  if (paramId === undefined) return undefined;
  return {
    ...found,
    param: first.name,
    paramId,
    stateId: stateSymbol.id,
    state,
    stateFile: declared.file,
    tag,
    tags: tags.sort(),
  };
}

/** The statements of a reducer's `return`s, not those of functions inside it. */
function returnsOf(fn: FunctionNode): { expression: ts.Expression; anchor: ts.Node }[] {
  const body = fn.body;
  if (body === undefined) return [];
  if (!ts.isBlock(body)) return [{ expression: body, anchor: body }];
  const found: { expression: ts.Expression; anchor: ts.Node }[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) found.push({ expression: node.expression, anchor: node });
      return;
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    ts.forEachChild(node, walk);
  };
  body.statements.forEach(walk);
  return found;
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a].filter((item) => b.has(item)));
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  return new Set([...a, ...b]);
}

/** Whether control cannot continue past the statement. */
function exits(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true;
  }
  if (ts.isBlock(statement)) return statement.statements.some(exits);
  if (ts.isIfStatement(statement)) {
    return (
      statement.elseStatement !== undefined &&
      exits(statement.thenStatement) &&
      exits(statement.elseStatement)
    );
  }
  return false;
}

const MAX_FOLLOWED = 6;

/** The initializer of the `const` a name stands for: `{ status: "idle" }` for `initialState`. */
function constantInitializer(name: ts.Identifier, types: TypeQueries): ts.Expression | undefined {
  const symbol = types.symbolAt(name);
  const declared = symbol && types.declarationOf(symbol);
  const node = declared?.node;
  return node !== undefined &&
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) !== 0
    ? node.initializer
    : undefined;
}

/** The reading of one reducer: the states each return starts from, and the event it is on. */
function reader(sig: Signature, ctx: FileContext) {
  const { types, sourceFile } = ctx;
  const universe: ReadonlySet<string> = new Set(sig.tags);
  const eventParam = sig.fn.parameters[1];
  const eventId =
    eventParam !== undefined && ts.isIdentifier(eventParam.name)
      ? types.symbolAt(eventParam.name)?.id
      : undefined;

  const isParam = (node: ts.Expression, id: string | undefined): boolean => {
    const inner = unwrapped(node);
    return id !== undefined && ts.isIdentifier(inner) && types.symbolAt(inner)?.id === id;
  };
  /** `state.status`. */
  const isTagAccess = (node: ts.Expression): boolean => {
    const inner = unwrapped(node);
    if (ts.isPropertyAccessExpression(inner)) {
      return inner.name.text === sig.tag && isParam(inner.expression, sig.paramId);
    }
    return (
      ts.isElementAccessExpression(inner) &&
      stringOf(inner.argumentExpression) === sig.tag &&
      isParam(inner.expression, sig.paramId)
    );
  };
  /** `event.type`, whatever the property. */
  const isEventAccess = (node: ts.Expression): boolean => {
    const inner = unwrapped(node);
    return ts.isPropertyAccessExpression(inner) && isParam(inner.expression, eventId);
  };

  /** The states for which a condition may be true, and those for which it may be false. */
  type Verdict = { whenTrue: Set<string>; whenFalse: Set<string> };
  const unread = (): Verdict => ({ whenTrue: new Set(universe), whenFalse: new Set(universe) });
  const verdict = (node: ts.Expression): Verdict => {
    const inner = unwrapped(node);
    if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = verdict(inner.operand);
      return { whenTrue: operand.whenFalse, whenFalse: operand.whenTrue };
    }
    if (!ts.isBinaryExpression(inner)) return unread();
    const op = inner.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      const left = verdict(inner.left);
      const right = verdict(inner.right);
      return op === ts.SyntaxKind.AmpersandAmpersandToken
        ? {
            whenTrue: intersect(left.whenTrue, right.whenTrue),
            whenFalse: union(left.whenFalse, right.whenFalse),
          }
        : {
            whenTrue: union(left.whenTrue, right.whenTrue),
            whenFalse: intersect(left.whenFalse, right.whenFalse),
          };
    }
    const equal =
      op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
    const different =
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !different) return unread();
    const literal = isTagAccess(inner.left)
      ? stringOf(inner.right)
      : isTagAccess(inner.right)
        ? stringOf(inner.left)
        : undefined;
    if (literal === undefined) return unread();
    const only = new Set(universe.has(literal) ? [literal] : []);
    const rest = new Set([...universe].filter((tag) => tag !== literal));
    return equal ? { whenTrue: only, whenFalse: rest } : { whenTrue: rest, whenFalse: only };
  };

  /** The labels of a `case` and of the empty cases that fall into it; undefined when not literal. */
  const caseLabels = (
    clauses: readonly (ts.CaseClause | ts.DefaultClause)[],
    index: number,
    read: (expression: ts.Expression) => string | undefined,
  ): string[] | undefined => {
    const labels: string[] = [];
    for (let at = index; at >= 0; at -= 1) {
      const clause = clauses[at];
      if (clause === undefined || !ts.isCaseClause(clause)) return undefined;
      const label = read(clause.expression);
      if (label === undefined) return undefined;
      labels.unshift(label);
      const before = clauses[at - 1];
      if (before === undefined || before.statements.length > 0) break;
    }
    return labels;
  };

  const clauseStates = (
    switchNode: ts.SwitchStatement,
    clause: ts.CaseOrDefaultClause,
  ): Set<string> => {
    const clauses = switchNode.caseBlock.clauses;
    const index = clauses.indexOf(clause);
    if (ts.isCaseClause(clause)) {
      const labels = caseLabels(clauses, index, stringOf);
      return labels === undefined
        ? new Set(universe)
        : new Set(labels.filter((l) => universe.has(l)));
    }
    const named = new Set<string>();
    for (const other of clauses) {
      if (!ts.isCaseClause(other)) continue;
      const label = stringOf(other.expression);
      if (label === undefined) return new Set(universe);
      named.add(label);
    }
    return new Set([...universe].filter((tag) => !named.has(tag)));
  };

  /** The states the tests around a statement allow, read from the `if`s and `switch`es on the tag. */
  const allowedAt = (anchor: ts.Node): Set<string> => {
    let allowed = new Set(universe);
    let child: ts.Node = anchor;
    while (child !== sig.fn) {
      const parent: ts.Node = child.parent;
      if (ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
        const statements: readonly ts.Statement[] = parent.statements;
        const index = statements.findIndex((statement) => statement === child);
        for (const earlier of statements.slice(0, Math.max(0, index))) {
          if (!ts.isIfStatement(earlier)) continue;
          const seen = verdict(earlier.expression);
          const thenExits = exits(earlier.thenStatement);
          if (earlier.elseStatement === undefined) {
            if (thenExits) allowed = intersect(allowed, seen.whenFalse);
          } else if (exits(earlier.elseStatement) && !thenExits) {
            allowed = intersect(allowed, seen.whenTrue);
          }
        }
      }
      if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
        const switchNode = parent.parent.parent;
        if (ts.isSwitchStatement(switchNode) && isTagAccess(switchNode.expression)) {
          allowed = intersect(allowed, clauseStates(switchNode, parent));
        }
      }
      if (ts.isIfStatement(parent)) {
        const seen = verdict(parent.expression);
        if (child === parent.thenStatement) allowed = intersect(allowed, seen.whenTrue);
        else if (child === parent.elseStatement) allowed = intersect(allowed, seen.whenFalse);
      }
      if (ts.isConditionalExpression(parent)) {
        const seen = verdict(parent.condition);
        if (child === parent.whenTrue) allowed = intersect(allowed, seen.whenTrue);
        else if (child === parent.whenFalse) allowed = intersect(allowed, seen.whenFalse);
      }
      child = parent;
    }
    return allowed;
  };

  /** The states `state` has where the returned expression mentions it, per the type checker. */
  const mentionedStates = (expression: ts.Expression): Set<string> | undefined => {
    let found: Set<string> | undefined;
    const state = { readable: true };
    const walk = (node: ts.Node): void => {
      if (!state.readable) return;
      if (
        ts.isIdentifier(node) &&
        node.text === sig.param.text &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
        types.symbolAt(node)?.id === sig.paramId
      ) {
        const tags = types.tagsOf(node, sig.tag);
        if (tags === "not-finite") {
          state.readable = false;
          return;
        }
        found ??= new Set();
        for (const literal of tags) if (typeof literal.value === "string") found.add(literal.value);
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(expression);
    return state.readable ? found : undefined;
  };

  /** The event a statement is under: `case "pay":` of a switch on `event.type`. */
  const eventOf = (anchor: ts.Node): string | null => {
    let child: ts.Node = anchor;
    while (child !== sig.fn) {
      const parent: ts.Node = child.parent;
      if (ts.isCaseClause(parent)) {
        const switchNode = parent.parent.parent;
        if (ts.isSwitchStatement(switchNode) && isEventAccess(switchNode.expression)) {
          const clauses = switchNode.caseBlock.clauses;
          const labels = caseLabels(clauses, clauses.indexOf(parent), stringOf);
          if (labels !== undefined) return labels.join("/");
        }
      }
      if (ts.isIfStatement(parent) && child === parent.thenStatement) {
        const test = unwrapped(parent.expression);
        if (
          ts.isBinaryExpression(test) &&
          (test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
        ) {
          const label = isEventAccess(test.left)
            ? stringOf(test.right)
            : isEventAccess(test.right)
              ? stringOf(test.left)
              : undefined;
          if (label !== undefined) return label;
        }
      }
      child = parent;
    }
    return null;
  };

  type Target =
    | { kind: "identity" }
    | { kind: "tags"; tags: string[] }
    | { kind: "whole" | "unknown"; node: ts.Expression; constant: boolean };

  /**
   * The states a returned expression is in; `return state` and `{ ...state }` change nothing. A
   * constant is read through its initializer, as a start is (`return initialState`).
   */
  const targetsOf = (expression: ts.Expression, followed = 0): Target[] => {
    const inner = unwrapped(expression);
    if (ts.isConditionalExpression(inner)) {
      return [...targetsOf(inner.whenTrue, followed), ...targetsOf(inner.whenFalse, followed)];
    }
    if (isParam(inner, sig.paramId)) return [{ kind: "identity" }];
    const constant = ts.isIdentifier(inner) ? constantInitializer(inner, types) : undefined;
    if (constant !== undefined && followed < MAX_FOLLOWED) {
      // Unreadable inside: reported at the return, as the constant it is.
      return targetsOf(constant, followed + 1).map((target) =>
        target.kind === "whole" || target.kind === "unknown"
          ? { kind: target.kind, node: inner, constant: true }
          : target,
      );
    }
    if (ts.isObjectLiteralExpression(inner)) {
      const spreadsState = inner.properties.some(
        (property) => ts.isSpreadAssignment(property) && isParam(property.expression, sig.paramId),
      );
      const setsTag = inner.properties.some(
        (property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          property.name.getText(sourceFile).replace(/^["']|["']$/g, "") === sig.tag,
      );
      if (spreadsState && !setsTag) return [{ kind: "identity" }];
    }
    const found = types.tagsOf(inner, sig.tag);
    if (found === "not-finite") return [{ kind: "unknown", node: inner, constant: false }];
    const tags = found.flatMap((literal) =>
      typeof literal.value === "string" ? [literal.value] : [],
    );
    if (tags.length !== found.length) return [{ kind: "unknown", node: inner, constant: false }];
    if (!ts.isObjectLiteralExpression(inner) && tags.length === universe.size) {
      return [{ kind: "whole", node: inner, constant: false }];
    }
    return [{ kind: "tags", tags }];
  };

  return { universe, allowedAt, mentionedStates, eventOf, targetsOf };
}

/** The edges and unreadable returns of one reducer. */
function graphOf(sig: Signature, ctx: FileContext): Pick<Reducer, "edges" | "unreadable"> {
  const { sourceFile } = ctx;
  const read = reader(sig, ctx);
  const edges: Edge[] = [];
  const unreadable: Unreadable[] = [];
  for (const { expression, anchor } of returnsOf(sig.fn)) {
    const to = new Set<string>();
    for (const target of read.targetsOf(expression)) {
      if (target.kind === "identity") continue;
      if (target.kind === "tags") {
        target.tags.forEach((tag) => to.add(tag));
        continue;
      }
      read.universe.forEach((tag) => to.add(tag));
      unreadable.push({
        kind: target.kind,
        text: shorten(target.node.getText(sourceFile), 40),
        constant: target.constant,
        ...place(target.node, sourceFile),
      });
    }
    if (to.size === 0) continue;
    const mentioned = read.mentionedStates(expression);
    const allowed = read.allowedAt(anchor);
    const from = mentioned === undefined ? allowed : intersect(allowed, mentioned);
    if (from.size === 0) continue;
    edges.push({
      from: [...from].sort(),
      read: from.size < read.universe.size,
      to: [...to].sort(),
      event: read.eventOf(anchor),
      ...place(expression, sourceFile),
    });
  }
  edges.sort((a, b) => a.start - b.start || a.end - b.end);
  unreadable.sort((a, b) => a.start - b.start || a.end - b.end);
  return { edges, unreadable };
}

/**
 * The `@tag "a" | "b"` line of a declaration's comment: the quoted names, separated by commas,
 * `|` or spaces, up to the first token that is not a quoted literal; where the tag is; and where
 * a name can be added (after the last literal, or after the tag).
 */
function namesOf(
  host: ts.Node,
  tagName: string,
  sourceFile: ts.SourceFile,
): { names: string[]; at: Place; lastEnd: number; prose: boolean } | null {
  for (const tag of ts.getJSDocTags(host)) {
    if (tag.tagName.text !== tagName) continue;
    const start = tag.getStart(sourceFile);
    const text = sourceFile.text.slice(start, tag.end);
    const head = (text.split("\n")[0] ?? "").replace(/\*\/\s*$/, "").trimEnd();
    const body = head.slice(tagName.length + 1);
    const names: string[] = [];
    let used = 0;
    const literal = /^[\s,|]*(?:"([^"]*)"|'([^']*)')/;
    for (let match = literal.exec(body); match !== null; match = literal.exec(body.slice(used))) {
      names.push(match[1] ?? match[2] ?? "");
      used += match[0].length;
    }
    const prose = names.length === 0 && body.trim() !== "";
    const lastEnd = start + tagName.length + 1 + (names.length === 0 ? 0 : used);
    return { names, at: { start, end: start + head.length }, lastEnd, prose };
  }
  return null;
}

/** Where each state is written in the state type: the literal of the tag in each member. */
function tagPlaces(
  state: ts.TypeAliasDeclaration,
  tag: string,
  sourceFile: ts.SourceFile,
): Record<string, Place> {
  const places: Record<string, Place> = {};
  const members = ts.isUnionTypeNode(state.type) ? state.type.types : [state.type];
  const literals = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) node.types.forEach(literals);
    else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      places[node.literal.text] ??= place(node, sourceFile);
    }
  };
  for (const member of members) {
    if (!ts.isTypeLiteralNode(member)) continue;
    for (const property of member.members) {
      if (
        ts.isPropertySignature(property) &&
        property.type !== undefined &&
        property.name.getText(sourceFile).replace(/^["']|["']$/g, "") === tag
      ) {
        literals(property.type);
      }
    }
  }
  return places;
}

function isExported(host: ts.Node): boolean {
  return (
    ts.canHaveModifiers(host) &&
    (ts.getModifiers(host)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

const FINAL_CONST = /FINAL_(?:STATES|STATUSES)$/;

/** Whether a type is `readonly State["tag"][]` (or `ReadonlyArray<State["tag"]>`). */
function isStateTags(type: ts.TypeNode, sig: Signature): boolean {
  let element: ts.TypeNode | undefined;
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) {
    element = ts.isArrayTypeNode(type.type) ? type.type.elementType : undefined;
  } else if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    ["ReadonlyArray", "Array"].includes(type.typeName.text) &&
    type.typeArguments?.length === 1
  ) {
    element = type.typeArguments[0];
  }
  if (element === undefined || !ts.isIndexedAccessTypeNode(element)) return false;
  const { objectType, indexType } = element;
  return (
    ts.isTypeReferenceNode(objectType) &&
    ts.isIdentifier(objectType.typeName) &&
    objectType.typeName.text === sig.state.name.text &&
    ts.isLiteralTypeNode(indexType) &&
    ts.isStringLiteral(indexType.literal) &&
    indexType.literal.text === sig.tag
  );
}

/**
 * The top-level `const` of the reducer's module whose name ends with `FINAL_STATES` or
 * `FINAL_STATUSES`, typed `as const satisfies readonly State["tag"][]`. A const without that
 * `satisfies` is not read: nothing would check its names.
 */
function finalConstOf(sig: Signature, sourceFile: ts.SourceFile): Reducer["finalConst"] {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !FINAL_CONST.test(declaration.name.text) ||
        declaration.initializer === undefined
      ) {
        continue;
      }
      let node: ts.Expression = declaration.initializer;
      let checked = false;
      for (;;) {
        if (ts.isParenthesizedExpression(node)) node = node.expression;
        else if (ts.isSatisfiesExpression(node)) {
          checked ||= isStateTags(node.type, sig);
          node = node.expression;
        } else if (ts.isAsExpression(node)) node = node.expression;
        else break;
      }
      if (!checked || !ts.isArrayLiteralExpression(node)) continue;
      const names = node.elements.flatMap((element) =>
        ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)
          ? [element.text]
          : [],
      );
      const text = sourceFile.text;
      const last = node.elements[node.elements.length - 1];
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      let add: { at: number; before: string };
      if (last === undefined) add = { at: node.getStart(sourceFile) + 1, before: "" };
      else {
        const start = last.getStart(sourceFile);
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        const indent = text.slice(lineStart, start);
        // One element a line: the new one goes on its own line, as the others are.
        add = /^[ \t]*$/.test(indent)
          ? { at: last.end, before: `,${eol}${indent}` }
          : { at: last.end, before: ", " };
      }
      return {
        name: declaration.name.text,
        names,
        at: place(declaration.name, sourceFile),
        add,
      };
    }
  }
  return null;
}

function readReducer(sig: Signature, ctx: FileContext): Reducer | undefined {
  const { types, sourceFile } = ctx;
  const id = types.symbolAt(sig.name)?.id;
  if (id === undefined) return undefined;
  const stateSource = sig.state.getSourceFile();
  const final = namesOf(sig.state, "final", stateSource);
  const initial = namesOf(sig.host, "initial", sourceFile) ?? defaultStart(sig, types, sourceFile);
  let finalFix: Reducer["finalFix"] = null;
  if (final !== null)
    finalFix = final.prose
      ? null
      : { at: final.lastEnd, create: false, separator: final.names.length === 0 ? " " : " | " };
  else if (ts.getJSDocCommentsAndTags(sig.state).length === 0) {
    finalFix = { at: sig.state.getStart(stateSource), create: true, separator: " " };
  }
  return {
    id,
    name: sig.name.text,
    at: place(sig.name, sourceFile),
    stateName: sig.state.name.text,
    stateFile: sig.stateFile,
    stateAt: place(sig.state.name, stateSource),
    tag: sig.tag,
    tags: sig.tags,
    tagAt: tagPlaces(sig.state, sig.tag, stateSource),
    final: final === null ? null : { names: final.names, at: final.at, prose: final.prose },
    finalFix,
    finalConst: finalConstOf(sig, sourceFile),
    initial:
      initial === null ? null : { names: initial.names, at: initial.at, prose: initial.prose },
    external: isExported(sig.host) && types.isPackageEntry(ctx.file),
    ...graphOf(sig, ctx),
  };
}

/**
 * `(state: State = initialState, action) => …`: the reducer starts where its default says, as if
 * `@initial` named those states. Null without a default, or when its tag cannot be read.
 */
function defaultStart(
  sig: Signature,
  types: TypeQueries,
  sourceFile: ts.SourceFile,
): { names: string[]; at: Place; prose: boolean } | null {
  const fallback = sig.fn.parameters[0]?.initializer;
  if (fallback === undefined) return null;
  const starts = startsOf(fallback, sig, types);
  return starts === null ? null : { names: starts, at: place(fallback, sourceFile), prose: false };
}

/** `useReducer` from React, called by its name or as a member (`React.useReducer`). */
function isUseReducer(call: ts.CallExpression, types: TypeQueries): boolean {
  const callee = call.expression;
  const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(named) || named.text !== "useReducer") return false;
  const symbol = types.symbolAt(named);
  const declared = symbol && types.declarationOf(symbol);
  if (declared === undefined) return false;
  const owner = types.packageOf(declared.file);
  return (
    owner === "react" ||
    owner === "@types/react" ||
    /\/node_modules\/(?:@types\/)?react\//.test(declared.file)
  );
}

/** The function a reducer reference names, when it is shaped like a reducer. */
function signatureBehind(
  name: ts.Expression,
  types: TypeQueries,
): { sig: Signature; id: string } | undefined {
  const inner = unwrapped(name);
  const target = ts.isPropertyAccessExpression(inner) ? inner.name : inner;
  if (!ts.isIdentifier(target)) return undefined;
  const symbol = types.symbolAt(target);
  const declared = symbol && types.declarationOf(symbol);
  if (symbol === undefined || declared === undefined || !types.isOwnFile(declared.file)) {
    return undefined;
  }
  const found = functionOf(declared.node);
  const sig = found && signatureOf(found, types);
  return sig === undefined ? undefined : { sig, id: symbol.id };
}

/** The function a name stands for, wherever it is declared. */
function functionNamed(expression: ts.Expression, types: TypeQueries): FunctionNode | undefined {
  const inner = unwrapped(expression);
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return inner;
  if (!ts.isIdentifier(inner)) return undefined;
  const symbol = types.symbolAt(inner);
  const declared = symbol && types.declarationOf(symbol);
  return declared === undefined ? undefined : functionOf(declared.node)?.fn;
}

/** The states an expression starts a reducer in; null when its tag cannot be read. */
function startsOf(
  expression: ts.Expression,
  sig: Signature,
  types: TypeQueries,
  followed = 0,
): string[] | null {
  const inner = unwrapped(expression);
  if (ts.isConditionalExpression(inner)) {
    const a = startsOf(inner.whenTrue, sig, types, followed);
    const b = startsOf(inner.whenFalse, sig, types, followed);
    return a === null || b === null ? null : [...new Set([...a, ...b])].sort();
  }
  if (ts.isIdentifier(inner) && followed < MAX_FOLLOWED) {
    // `const initialState: State = { status: "cart" }`: the annotation hides the tag.
    const initializer = constantInitializer(inner, types);
    if (initializer !== undefined) return startsOf(initializer, sig, types, followed + 1);
  }
  const found = types.tagsOf(inner, sig.tag);
  if (found === "not-finite") return null;
  const tags = found.flatMap((literal) =>
    typeof literal.value === "string" ? [literal.value] : [],
  );
  if (tags.length !== found.length) return null;
  if (!ts.isObjectLiteralExpression(inner) && tags.length === sig.tags.length) return null;
  return tags;
}

function useOf(call: ts.CallExpression, ctx: FileContext): Use | undefined {
  const { types, sourceFile } = ctx;
  const [reducer, initial, init] = call.arguments;
  if (reducer === undefined || call.arguments.some(ts.isSpreadElement)) return undefined;
  const behind = signatureBehind(reducer, types);
  if (behind === undefined) return undefined;
  const at = place(initial ?? call, sourceFile);
  if (initial === undefined) return { reducer: behind.id, starts: null, at };
  if (init === undefined)
    return { reducer: behind.id, starts: startsOf(initial, behind.sig, types), at };
  // `useReducer(reducer, arg, init)` starts in what `init` returns.
  const fn = functionNamed(init, types);
  if (fn === undefined) return { reducer: behind.id, starts: null, at };
  const tags = new Set<string>();
  for (const { expression } of returnsOf(fn)) {
    const starts = startsOf(expression, behind.sig, types);
    if (starts === null) return { reducer: behind.id, starts: null, at };
    starts.forEach((tag) => tags.add(tag));
  }
  return { reducer: behind.id, starts: [...tags].sort(), at };
}

/** Whether an identifier sits where a function value may be handed on or called. */
function isValuePosition(identifier: ts.Identifier): boolean {
  let node: ts.Node = identifier;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) node = node.parent;
  else if (ts.isPropertyAccessExpression(node.parent)) return false;
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAsExpression(node.parent) ||
    ts.isNonNullExpression(node.parent) ||
    ts.isSatisfiesExpression(node.parent)
  ) {
    node = node.parent;
  }
  const parent = node.parent;
  return (
    ts.isCallExpression(parent) ||
    ts.isNewExpression(parent) ||
    (ts.isVariableDeclaration(parent) && parent.initializer === node) ||
    ts.isArrayLiteralExpression(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === node) ||
    ts.isShorthandPropertyAssignment(parent) ||
    ts.isReturnStatement(parent) ||
    ts.isExportAssignment(parent) ||
    (ts.isArrowFunction(parent) && parent.body === node) ||
    ts.isJsxExpression(parent) ||
    (ts.isBinaryExpression(parent) && parent.right === node)
  );
}

type Found = { reducers: Reducer[]; uses: Use[]; references: Reference[] };

function visit(node: ts.Node, found: Found, ctx: FileContext, skipReferences: boolean): void {
  const { types, sourceFile } = ctx;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
  const declared = functionOf(node);
  if (declared !== undefined) {
    const sig = signatureOf(declared, types);
    const reducer = sig && readReducer(sig, ctx);
    if (reducer !== undefined) found.reducers.push(reducer);
  }
  if (ts.isCallExpression(node) && isUseReducer(node, types)) {
    const use = useOf(node, ctx);
    if (use !== undefined) found.uses.push(use);
  } else if (!skipReferences && ts.isIdentifier(node) && isValuePosition(node)) {
    const behind = signatureBehind(node, types);
    if (behind !== undefined && !isInside(node, behind.sig.fn)) {
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
      found.references.push({
        id: behind.id,
        kind: call ? "call" : "value",
        at: place(node, sourceFile),
      });
    }
  }
  ts.forEachChild(node, (child) => {
    visit(child, found, ctx, skipReferences || isUseReducerReducer(node, child, types));
  });
}

/** Whether `child` is the reducer argument of `useReducer(…)`: a use, not another reference. */
function isUseReducerReducer(parent: ts.Node, child: ts.Node, types: TypeQueries): boolean {
  return (
    ts.isCallExpression(parent) && parent.arguments[0] === child && isUseReducer(parent, types)
  );
}

function isInside(node: ts.Node, outer: ts.Node): boolean {
  return ts.findAncestor(node, (ancestor) => ancestor === outer) !== undefined;
}

function summarize(ctx: FileContext): FileSummary | undefined {
  const found: Found = { reducers: [], uses: [], references: [] };
  visit(ctx.sourceFile, found, ctx, isTestFile(ctx.file));
  const byPlace = (a: Place, b: Place): number => a.start - b.start || a.end - b.end;
  found.reducers.sort((a, b) => byPlace(a.at, b.at));
  found.uses.sort((a, b) => byPlace(a.at, b.at));
  found.references.sort((a, b) => byPlace(a.at, b.at));
  return found.reducers.length === 0 && found.uses.length === 0 && found.references.length === 0
    ? undefined
    : found;
}

/**
 * The reducers this file declares with their graphs, the `useReducer` calls it makes and the
 * other places it calls or hands on a reducer; undefined when none. The three rules share it.
 */
export function summarizeFile(ctx: FileContext): FileSummary | undefined {
  const files = memoOf(ctx.types).summaries;
  if (files.has(ctx.file)) return files.get(ctx.file);
  const summary = summarize(ctx);
  files.set(ctx.file, summary);
  return summary;
}
