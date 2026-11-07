import ts from "@stateward/core/typescript";
import {
  matchesName,
  type FileContext,
  type Fix,
  type FixForm,
  type TextEdit,
} from "@stateward/core";
import { compactText, oneLineText } from "./text.js";

/** The code a rule shares with the others that ask for a `never` proof. */

export function stripParentheses(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression)
    ? stripParentheses(expression.expression)
    : expression;
}

/**
 * `status` proves a switch on `status.kind` too: it is `never` in the default only when every
 * `kind` is handled. So an argument counts when it is the subject or the object the subject reads.
 */
function namesSubject(text: string, subject: string): boolean {
  return (
    text === subject ||
    (subject.startsWith(text) && /^(?:\.|\?\.|\[)/.test(subject.slice(text.length)))
  );
}

function isFunctionLike(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isModuleDeclaration(node);
}

/** The operators whose right side may not run. */
const SHORT_CIRCUIT: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * The statements that always run when the branch does: its own, or those of a block that is its
 * only statement. A statement inside an `if`, a loop or a `try` may not run, so it is not here.
 */
export function alwaysRunning(statements: readonly ts.Statement[]): readonly ts.Statement[] {
  const [only, ...rest] = statements;
  if (only !== undefined && rest.length === 0 && ts.isBlock(only)) return only.statements;
  return statements;
}

/**
 * Whether the statements apply the subject to `never`: the three forms below. Only a
 * proof that runs every time counts: an expression statement, `return`, `throw` or a variable
 * declaration of the branch itself, not inside a function, a branch of `&&`, `||`, `??` or `?:`.
 */
export function provesCompleteness(
  statements: readonly ts.Statement[],
  subject: string,
  ctx: FileContext,
  /**
   * The labels of the cases that fall through. A check against a type that names exactly these
   * (`x satisfies Exclude<Event["type"], "click" | "key">`) says "these, and only these, fall
   * through on purpose": a member added later fails to compile there, like `never` does.
   */
  rest?: readonly string[],
): boolean {
  // `(type) satisfies never` names `type` as well: the parentheses keep it from starting a declaration.
  const named = (node: ts.Node): boolean =>
    namesSubject(
      compactText(ts.isExpression(node) ? stripParentheses(node) : node, ctx.sourceFile),
      subject,
    );
  const namesRest = (type: ts.TypeNode): boolean => {
    if (rest === undefined || rest.length === 0) return false;
    const literals = ctx.types.literalsOf(type);
    return (
      literals !== "not-finite" &&
      literals.length === rest.length &&
      literals.every((literal) => rest.includes(literal.label))
    );
  };
  // Only the subject itself: `event` against a union of tags would not compile, and `event.type`
  // in the default is exactly the cases that fall through.
  const isSubject = (node: ts.Node): boolean =>
    ts.isExpression(node) && compactText(stripParentheses(node), ctx.sourceFile) === subject;
  const isProof = (node: ts.Node): boolean => {
    if (ts.isSatisfiesExpression(node)) {
      return node.type.kind === ts.SyntaxKind.NeverKeyword
        ? named(node.expression)
        : namesRest(node.type) && isSubject(node.expression);
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer === undefined) return false;
      return node.type?.kind === ts.SyntaxKind.NeverKeyword
        ? named(node.initializer)
        : node.type !== undefined && namesRest(node.type) && isSubject(node.initializer);
    }
    if (ts.isCallExpression(node)) {
      return node.arguments.some(
        (argument, index) => named(argument) && ctx.types.parameterIsNever(node, index),
      );
    }
    return false;
  };
  const found = (node: ts.Node): boolean => {
    if (isProof(node)) return true;
    if (isFunctionLike(node)) return false;
    if (ts.isBinaryExpression(node) && SHORT_CIRCUIT.has(node.operatorToken.kind)) {
      return found(node.left);
    }
    if (ts.isConditionalExpression(node)) return found(node.condition);
    return ts.forEachChild(node, found) === true;
  };
  const runs = (statement: ts.Statement): boolean => {
    if (ts.isExpressionStatement(statement)) return found(statement.expression);
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
      return statement.expression !== undefined && found(statement.expression);
    }
    return ts.isVariableStatement(statement) && found(statement.declarationList);
  };
  return alwaysRunning(statements).some(runs);
}

/**
 * The call in the statements that hands the subject to a function whose type does not resolve
 * (`exhaustiveSwitchError(info, "type")` imported from a package whose types are not built): it
 * may well be a `never` check, so whether the branch is complete cannot be decided. Only a call
 * that always runs counts, as for `provesCompleteness`.
 */
export function unresolvedCheck(
  statements: readonly ts.Statement[],
  subject: string,
  ctx: FileContext,
): ts.CallExpression | undefined {
  for (const statement of alwaysRunning(statements)) {
    const expression = ts.isExpressionStatement(statement)
      ? statement.expression
      : (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) &&
          statement.expression !== undefined
        ? statement.expression
        : undefined;
    if (expression === undefined) continue;
    const call = stripParentheses(expression);
    if (
      ts.isCallExpression(call) &&
      ctx.types.isErrorType(call.expression) &&
      call.arguments.some((argument) =>
        namesSubject(compactText(stripParentheses(argument), ctx.sourceFile), subject),
      )
    ) {
      return call;
    }
  }
  return undefined;
}

/** The indentation of the line that holds `position`. */
export function leadingSpace(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/**
 * Inserts `<target> satisfies never;` as the first statement of a branch, on its own line, at the
 * indentation of that statement (or one level in from `outer` when the statement shares its line
 * with the opening `:` or `{`). `place` names the branch in the title ("default", "else").
 */
export function insertProof(input: {
  first: ts.Statement;
  /** The `:` of a `default` or the `{` of a block: the statement may share its line. */
  opener: ts.Node | undefined;
  /** The `default` or `else` keyword: its line gives the indentation. */
  outer: ts.Node;
  check: Check;
  place: string;
  /** Edits the check needs elsewhere: a `const` of the tag, a case split from the default. */
  before?: readonly TextEdit[];
  /**
   * The check that names the cases falling through on purpose, instead of `never`: the subject
   * itself (`event.type`, not the object) against the type that names exactly those cases.
   */
  rest?: { subject: string; type: string } | undefined;
  ctx: FileContext;
}): Fix | undefined {
  const { first, opener, outer, check, place, ctx } = input;
  const text = ctx.sourceFile.text;
  const proof =
    input.rest === undefined
      ? satisfiesStatement(check.target)
      : satisfiesStatement(input.rest.subject, input.rest.type);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const start = first.getStart(ctx.sourceFile);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const title =
    check.tag === undefined || input.rest !== undefined
      ? `Add \`${proof}\` to the ${place}`
      : `Put \`${check.tag.subject}\` in \`const ${check.target}\` and add \`${proof}\` to the ${place}`;
  // Saying "these cases all mean the same" is the developer's decision, not a mechanical one:
  // `--fix` and fix-all never make it for them.
  const safe = input.rest === undefined;
  // The inline check reads the subject as it is: it needs no `const` of the tag.
  const edits = [...(input.rest === undefined ? check.setup : []), ...(input.before ?? [])];
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    const indent = text.slice(lineStart, start);
    const location = { file: ctx.file, start: lineStart, end: lineStart };
    return {
      title,
      safe,
      edits: [...edits, { location, newText: `${indent}${proof}${eol}` }],
    };
  }
  if (opener === undefined) return undefined;
  const outerIndent = leadingSpace(text, outer.getStart(ctx.sourceFile));
  const indent = outerIndent + (outerIndent.includes("\t") ? "\t" : "  ");
  const location = { file: ctx.file, start: opener.end, end: start };
  return {
    title,
    safe,
    edits: [...edits, { location, newText: `${eol}${indent}${proof}${eol}${indent}` }],
  };
}

/**
 * What the default must be proven on. In a discriminated union `s` is `never` in the default and
 * `s.kind` no longer compiles, so for `switch (s.kind)` the proof is on `s`. For anything else (a
 * plain object whose property is the union, `{ kind: "a" | "b" }`; members that share the property
 * as a union; `o?.kind` with `o` possibly undefined) `s` is not narrowed and `s.kind` itself is
 * the proof.
 */
export function proofTarget(subject: ts.Expression, ctx: FileContext): ts.Expression {
  if (
    ts.isPropertyAccessExpression(subject) &&
    ctx.types.isDiscriminant(subject.expression, subject.name.text)
  ) {
    return subject.expression;
  }
  return subject;
}

/** One level of indentation in the style the file already uses at `indent`. */
export function indentUnit(indent: string): string {
  return indent.includes("\t") ? "\t" : "  ";
}

/**
 * Where to insert text after `position`: the end of its line when only spaces or a `//` comment
 * follow it, so the inserted lines do not take that comment along.
 */
export function afterLine(text: string, position: number): number {
  const lineEnd = text.indexOf("\n", position);
  const end = lineEnd === -1 ? text.length : lineEnd;
  const rest = text.slice(position, end).replace(/\r$/, "");
  if (!/^[ \t]*(?:\/\/.*)?$/.test(rest)) return position;
  return text[end - 1] === "\r" ? end - 1 : end;
}

/** `Color.Red` as the enum (`Color`) and the member (`Red`); undefined for any other label. */
function enumParts(label: string): { owner: string; member: string } | undefined {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(label)) return undefined;
  const dot = label.lastIndexOf(".");
  return { owner: label.slice(0, dot), member: label.slice(dot + 1) };
}

/**
 * How the code already names each enum it compares with, by the enum's label (`Color` for
 * `Color.Red`): an import may rename it, so a new `case` copies what the developer wrote.
 */
export function enumSpellings(
  values: readonly ts.Expression[],
  ctx: FileContext,
): Map<string, string> {
  const spellings = new Map<string, string>();
  for (const value of values) {
    const inner = stripParentheses(value);
    if (!ts.isPropertyAccessExpression(inner)) continue;
    const literals = ctx.types.literalsOf(inner);
    const [only] = literals === "not-finite" ? [] : literals;
    const parts = only === undefined || literals.length !== 1 ? undefined : enumParts(only.label);
    if (parts === undefined || spellings.has(parts.owner)) continue;
    spellings.set(parts.owner, oneLineText(inner.expression, ctx.sourceFile));
  }
  return spellings;
}

/**
 * The code for one member of a literal union: the literal itself, or `Enum.Member` spelled as the
 * code spells that enum. Undefined when the member cannot be written as one value (an object
 * type, or an enum the code never names).
 */
export function valueCode(
  label: string,
  spellings: ReadonlyMap<string, string>,
): string | undefined {
  if (label.startsWith('"') || /^-?\d/.test(label)) return label;
  if (["true", "false", "null", "undefined"].includes(label)) return label;
  const parts = enumParts(label);
  const owner = parts === undefined ? undefined : spellings.get(parts.owner);
  return parts === undefined || owner === undefined ? undefined : `${owner}.${parts.member}`;
}

/** Whether an expression reads the same value twice: a name, `this`, or a property path on one. */
export function isPlainReference(expression: ts.Expression): boolean {
  const inner = stripParentheses(expression);
  if (ts.isIdentifier(inner) || inner.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(inner) && isPlainReference(inner.expression);
}

/** The quick fix that lists hidden cases keeps what the code does for every value of the type. */
export function listTitle(count: number): string {
  return count === 1
    ? "List the missing case (same behaviour)"
    : `List the ${String(count)} missing cases (same behaviour)`;
}

/** The `break`, `return`, `throw` or `continue` that ends a branch for sure, if it ends with one. */
export function finalJump(statement: ts.Statement): ts.Statement | undefined {
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last === undefined ? undefined : finalJump(last);
  }
  return ts.isBreakStatement(statement) ||
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isContinueStatement(statement)
    ? statement
    : undefined;
}

export function isJump(statement: ts.Statement): boolean {
  return finalJump(statement) !== undefined;
}

/** The names a branch declares itself (`const x`, `function f`), anywhere in it. */
function declaredNames(statements: readonly ts.Statement[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  return names;
}

function readsAny(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node) && names.has(node.text)) return true;
  return ts.forEachChild(node, (child) => readsAny(child, names)) === true;
}

/**
 * The jump that ends a branch, for a new branch to end the same way: the old branch returned, so
 * a new one that ran off its end would make TypeScript say not all paths return. `"none"` when the
 * branch does not end with a jump; undefined when the jump reads a name the branch declares,
 * which a copy elsewhere could not read.
 */
export function jumpToCopy(statements: readonly ts.Statement[]): ts.Statement | "none" | undefined {
  const last = statements[statements.length - 1];
  const jump = last === undefined ? undefined : finalJump(last);
  if (jump === undefined) return "none";
  return readsAny(jump, declaredNames(statements)) ? undefined : jump;
}

/**
 * Words that start a declaration when a statement begins with them: `type satisfies never;` is
 * read as a broken `type` alias, `module x` as a module. A check on a value with such a name is
 * written `void (type satisfies never);`.
 */
const STATEMENT_WORDS: ReadonlySet<string> = new Set([
  "abstract",
  "accessor",
  "async",
  "await",
  "declare",
  "let",
  "module",
  "namespace",
  "readonly",
  "type",
  "using",
]);

/** The statement that checks `target` is `type` (`never` by default), written so it parses as an expression. */
export function satisfiesStatement(target: string, type = "never"): string {
  return STATEMENT_WORDS.has(target)
    ? `void (${target} satisfies ${type});`
    : `${target} satisfies ${type};`;
}

/**
 * The type that names exactly the cases a `default` or `else` takes today, for the example that
 * says "these fall through on purpose": the cases themselves (`"a" | "b"`). Never
 * `Exclude<Status, …>`: it grows when `Status` gains a case, so the new case would fall through
 * unnoticed again. Undefined when a case cannot be written as a type (an enum the code never
 * names): the hint then offers the ignore comment.
 */
export function restType(input: {
  hidden: readonly string[];
  spellings: ReadonlyMap<string, string>;
}): string | undefined {
  const codes = input.hidden.map((label) => valueCode(label, input.spellings));
  return codes.every((code) => code !== undefined) ? codes.join(" | ") : undefined;
}

/** The example line of a hint that says which cases fall through, or the ignore comment. */
export function restExample(input: {
  rule: string;
  /** The line's start and end around the check: `default: ` or `else { ` and ` }`. */
  frame: { before: string; after: string };
  subject: string;
  type: string | undefined;
}): { line: string; spelled: boolean; type: string | undefined } {
  const { rule, frame, subject, type } = input;
  const line =
    type === undefined
      ? undefined
      : `${frame.before}${satisfiesStatement(subject, type)}${frame.after}`;
  // An example line is at most 100 characters (4 spaces of indent included).
  return line !== undefined && line.length <= 96
    ? { line, spelled: true, type }
    : { line: ignoreLine(rule), spelled: false, type: undefined };
}

/** What a check names, and the edits that make that name exist. */
export type Check = {
  /** The text the check is on: `status`, `mode`, or the new `const` (`nodeType`). */
  target: string;
  /** The `const` of the tag that replaces the subject, when there is one. */
  tag: { subject: string } | undefined;
  /** Edits every fix that uses this check needs: declaring the `const`, switching on it. */
  setup: readonly TextEdit[];
};

/** The hooks whose first argument the React hooks lint rule reads for dependencies. */
const DEPENDENCY_HOOKS: ReadonlySet<string> = new Set([
  "useCallback",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
]);

/** Whether `node` is inside the function passed first to `useMemo`, `useEffect` and the like. */
function inHookCallback(node: ts.Node): boolean {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    const call = current.parent;
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isCallExpression(call) &&
      call.arguments[0] === current
    ) {
      const callee = call.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name !== undefined && DEPENDENCY_HOOKS.has(name)) return true;
    }
  }
  return false;
}

/** Whether every read of `object` inside `scope` is `object.<tag>`, and none is written to. */
function readsOnlyTag(scope: ts.Node, object: string, tag: string, ctx: FileContext): boolean {
  const reads = (node: ts.Node): boolean => {
    const isName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
    if (
      !isName &&
      (ts.isIdentifier(node) ||
        ts.isPropertyAccessExpression(node) ||
        node.kind === ts.SyntaxKind.ThisKeyword) &&
      compactText(node, ctx.sourceFile) === object
    ) {
      const parent = node.parent;
      const tagRead =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === tag &&
        !(
          ts.isBinaryExpression(parent.parent) &&
          parent.parent.left === parent &&
          parent.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          parent.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        );
      return !tagRead;
    }
    return ts.forEachChild(node, reads) === true;
  };
  return !reads(scope);
}

/** Every name written in the file: a new `const` must not take one of them. */
function namesIn(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function capitalised(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * A name for the `const` of `object.tag`: the last word of the object's name and the tag
 * (`selectedNode.type` gives `nodeType`), then the whole name (`selectedNodeType`); undefined when
 * the file already uses both.
 */
function tagName(object: ts.Expression, tag: string, ctx: FileContext): string | undefined {
  const last = ts.isPropertyAccessExpression(object)
    ? object.name.text
    : ts.isIdentifier(object)
      ? object.text
      : "value";
  const words = last.split(/(?=[A-Z])/);
  const lastWord = (words[words.length - 1] ?? last).toLowerCase();
  const taken = namesIn(ctx.sourceFile);
  return [`${lastWord}${capitalised(tag)}`, `${last}${capitalised(tag)}`].find(
    (name) => /^[A-Za-z_$][\w$]*$/.test(name) && !taken.has(name) && !STATEMENT_WORDS.has(name),
  );
}

/**
 * What a switch or chain on `subject` is checked on. In a discriminated union the object is
 * `never` once every tag is handled, so the check names the object (`target`); otherwise the
 * subject itself. Inside a hook callback, naming the object would add it to the hook's
 * dependencies (react-hooks/exhaustive-deps): when the code there reads only its tag, the tag goes
 * into a `const` before `statement`, `references` are replaced by it, and the check names it.
 */
export function checkOf(input: {
  subject: ts.Expression;
  target: ts.Expression;
  statement: ts.Statement;
  references: readonly ts.Expression[];
  ctx: FileContext;
}): Check {
  const { subject, target, statement, references, ctx } = input;
  const plain: Check = { target: oneLineText(target, ctx.sourceFile), tag: undefined, setup: [] };
  if (target === subject || !ts.isPropertyAccessExpression(subject)) return plain;
  const tag = subject.name.text;
  const text = ctx.sourceFile.text;
  const start = statement.getStart(ctx.sourceFile);
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  // A `const` can go before the statement only where a statement list holds it, on its own line.
  const parent = statement.parent;
  const inList =
    ts.isBlock(parent) ||
    ts.isSourceFile(parent) ||
    ts.isModuleBlock(parent) ||
    ts.isCaseOrDefaultClause(parent);
  if (!inList || !/^[ \t]*$/.test(text.slice(lineStart, start))) return plain;
  if (!inHookCallback(statement)) return plain;
  if (!readsOnlyTag(statement, compactText(target, ctx.sourceFile), tag, ctx)) return plain;
  const name = tagName(target, tag, ctx);
  if (name === undefined) return plain;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const shown = oneLineText(subject, ctx.sourceFile);
  const at = (from: number, to: number) => ({ file: ctx.file, start: from, end: to });
  return {
    target: name,
    tag: { subject: shown },
    setup: [
      {
        location: at(start, start),
        newText: `const ${name} = ${shown};${eol}${leadingSpace(text, start)}`,
      },
      ...references.map((reference) => ({
        location: at(reference.getStart(ctx.sourceFile), reference.end),
        newText: name,
      })),
    ],
  };
}

/** A function of the project's own that takes `never`, as the file calls it. */
export type NeverHelper = {
  name: string;
  /** Its calls are typed `never` (it throws): `return helper(x)` ends any function. */
  returnsNever: boolean;
};

/** By program (its queries) and file: an edit to the helper's own file makes a new program. */
const helpers = new WeakMap<object, WeakMap<ts.SourceFile, { helper: NeverHelper | undefined }>>();

/** The names the file declares or imports at its top level: a call to one reaches it anywhere. */
function topLevelNames(sourceFile: ts.SourceFile): Map<string, ts.Identifier> {
  const names = new Map<string, ts.Identifier>();
  const add = (name: ts.Identifier): void => {
    names.set(name.text, name);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      add(statement.name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name);
      }
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      if (clause.name !== undefined) add(clause.name);
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) add(element.name);
        }
      }
    }
  }
  return names;
}

/**
 * A function declared to take `never` first and nothing else it requires
 * (`function ensureNever(value: never, label?: string): never`): `helper(x)` compiles. Read from
 * its declaration, so a helper the file imports but has not called yet counts too.
 */
function declaredHelper(
  name: ts.Identifier,
  ctx: FileContext,
): { returnsNever: boolean } | undefined {
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  const fn =
    declared !== undefined &&
    ts.isVariableDeclaration(declared) &&
    declared.initializer !== undefined &&
    (ts.isArrowFunction(declared.initializer) || ts.isFunctionExpression(declared.initializer))
      ? declared.initializer
      : declared;
  if (
    fn === undefined ||
    !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
  ) {
    return undefined;
  }
  const [first, ...rest] = fn.parameters;
  if (first?.type?.kind !== ts.SyntaxKind.NeverKeyword || first.dotDotDotToken !== undefined) {
    return undefined;
  }
  const optional = rest.every(
    (parameter) =>
      parameter.questionToken !== undefined ||
      parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined,
  );
  return optional ? { returnsNever: fn.type?.kind === ts.SyntaxKind.NeverKeyword } : undefined;
}

/**
 * The project's own `never` helper (`ensureNever(x)`, `assertNever(x)`) as this file can call it:
 * among the functions it declares or imports at the top, one that takes `never`, the one it calls
 * most (by name on a tie). A fix that calls it then compiles as the file's own calls do.
 * Undefined when the file has none.
 */
export function neverHelper(ctx: FileContext): NeverHelper | undefined {
  const byFile = helpers.get(ctx.types) ?? new WeakMap();
  helpers.set(ctx.types, byFile);
  const known = byFile.get(ctx.sourceFile);
  if (known !== undefined) return known.helper;
  const reachable = topLevelNames(ctx.sourceFile);
  const counts = new Map<string, { calls: number; returnsNever: boolean }>();
  for (const [name, identifier] of reachable) {
    const declared = declaredHelper(identifier, ctx);
    if (declared !== undefined) counts.set(name, { calls: 0, ...declared });
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      reachable.has(node.expression.text) &&
      node.arguments.length === 1 &&
      !node.arguments.some(ts.isSpreadElement) &&
      ctx.types.parameterIsNever(node, 0)
    ) {
      const name = node.expression.text;
      const entry = counts.get(name);
      const returnsNever = ctx.types.typeTextOf(node) === "never";
      counts.set(name, {
        calls: (entry?.calls ?? 0) + 1,
        returnsNever: (entry?.returnsNever ?? true) && returnsNever,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  const [best] = [...counts.entries()].sort(
    ([a, x], [b, y]) => y.calls - x.calls || (a < b ? -1 : a > b ? 1 : 0),
  );
  const helper =
    best === undefined ? undefined : { name: best[0], returnsNever: best[1].returnsNever };
  byFile.set(ctx.sourceFile, { helper });
  return helper;
}

/**
 * The statements a new branch that only checks ends with: the project's helper when it has one,
 * else `x satisfies never;`, then `jump` (the old branch's `return`, ...). A helper typed `never`
 * that replaces a `return` is returned itself, so no code follows it.
 */
export function checkStatements(input: {
  target: string;
  helper: NeverHelper | undefined;
  jump: ts.Statement | "none";
  /** In a switch, a final `break` only ends the switch, as the new `default` does by itself. */
  inSwitch: boolean;
  sourceFile: ts.SourceFile;
}): string[] {
  const { target, helper, jump, inSwitch, sourceFile } = input;
  const jumpText =
    jump === "none" || (inSwitch && ts.isBreakStatement(jump)) ? [] : [jump.getText(sourceFile)];
  if (helper === undefined) return [satisfiesStatement(target), ...jumpText];
  const call = `${helper.name}(${target})`;
  if (helper.returnsNever && jump !== "none" && ts.isReturnStatement(jump))
    return [`return ${call};`];
  // A `throw` or `continue` after a call typed `never` would be code that never runs.
  if (helper.returnsNever && jumpText.length > 0) return [satisfiesStatement(target), ...jumpText];
  return [`${call};`, ...jumpText];
}

/**
 * How a hint names the check that ends a chain or switch: the project's helper, else
 * `satisfies never`; a stateward package only as the "or" when it fits and the file has no helper.
 */
export function checkCode(target: string, helper: NeverHelper | undefined): string {
  return helper === undefined ? satisfiesStatement(target) : `${helper.name}(${target});`;
}

/** The `stateward-ignore` line that says why a `default` or `else` is right for every hidden case. */
export function ignoreLine(rule: string): string {
  return `// stateward-ignore unions/${rule}: <why>`;
}

/**
 * Whether the config's `ignore` names the union a switch or chain tests: the type of the value
 * (`Mode`), or of the object whose tag it is (`AppEvent` for `event.type`).
 */
export function ignoredType(
  subject: ts.Expression,
  ignore: readonly string[],
  ctx: FileContext,
): boolean {
  if (ignore.length === 0) return false;
  const types = [ctx.types.typeTextOf(subject)];
  if (ts.isPropertyAccessExpression(subject)) types.push(ctx.types.typeTextOf(subject.expression));
  return types.some((type) => matchesName(type, ignore));
}

/**
 * Every check a fix may write, best first: the `const` of the tag (in a hook callback), then the
 * object or the subject as `isDiscriminant` judges which TypeScript narrows, then the other one.
 * Core offers the first form that compiles, so a wrong guess about narrowing costs nothing.
 */
export function checkForms(input: {
  subject: ts.Expression;
  target: ts.Expression;
  statement: ts.Statement;
  references: readonly ts.Expression[];
  ctx: FileContext;
}): Check[] {
  const { subject, target, ctx } = input;
  const plain = (expression: ts.Expression): Check => ({
    target: oneLineText(expression, ctx.sourceFile),
    tag: undefined,
    setup: [],
  });
  const object = ts.isPropertyAccessExpression(subject) ? subject.expression : undefined;
  const others = target === subject ? [subject, object] : [target, subject];
  const forms = [checkOf(input)];
  for (const expression of others) {
    if (expression === undefined) continue;
    const check = plain(expression);
    if (!forms.some((form) => form.tag === undefined && form.target === check.target)) {
      forms.push(check);
    }
  }
  return forms;
}

/** The forms of one fix as core takes them: the first, then the others as its alternatives. */
export function withAlternatives(forms: readonly (FixForm | undefined)[]): Fix | undefined {
  const [first, ...rest] = forms.filter((form) => form !== undefined);
  if (first === undefined) return undefined;
  return rest.length === 0 ? first : { ...first, alternatives: rest };
}
