import ts from "@stateward/core/typescript";
import {
  defineRule,
  option,
  type FileContext,
  type Fix,
  type Json,
  type Literal,
  type TextEdit,
} from "@stateward/core";
import {
  alwaysRunning,
  enumSpellings,
  ignoredType,
  ignoreLine,
  indentUnit,
  isPlainReference,
  leadingSpace,
  proofTarget,
  restType,
  stripParentheses,
  valueCode,
} from "./cases.js";
import { EXPLAIN } from "./non-exhaustive-switch.explain.js";
import { OPEN_UNION, type OpenSummary } from "./open-union.js";
import { HEADLINE_MAX, compactText, fitted, fittedCases, oneLineText } from "./text.js";

export const RULE_NAME = "non-exhaustive-switch";

/**
 * The labels the case clauses cover, or undefined when a case is not one literal (`case other:` with
 * `other: string`): then the switch cannot be judged.
 */
function coveredLabels(
  clauses: readonly ts.CaseOrDefaultClause[],
  ctx: FileContext,
): Set<string> | undefined {
  const covered = new Set<string>();
  for (const clause of clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const literals = ctx.types.literalsOf(clause.expression);
    // A case whose type is several literals (`case mode:`) matches only one of them at run time.
    const [only] = literals === "not-finite" ? [] : literals;
    if (only === undefined || literals.length !== 1) return undefined;
    covered.add(only.label);
    // `case Status.Issued` over `"issued" | …`: TypeScript narrows by the value, so the member also
    // covers the plain literal it equals (Infisical, user trial 1.0.2).
    const plain = plainLabel(only.value);
    if (plain !== undefined) covered.add(plain);
  }
  return covered;
}

/** How TypeScript prints a plain string or number literal: `"issued"`, `3`. */
function plainLabel(value: Literal["value"]): string | undefined {
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "number" ? String(value) : undefined;
}

/** A statement in the `default` that allows cases: `void (x satisfies "a" | "b");`, and its type. */
type Allowance = { statement: ts.Statement; type: ts.TypeNode; labels: readonly string[] };

/**
 * The cases the `default` allows: a check of the subject against a type other than `never` at the
 * top of it (`void (type satisfies "a" | "b");`, `type satisfies "a";`, `const rest: "a" = type;`).
 * A check against `never` allows nothing, like a plain `default`: with the rule on, stateward
 * checks what `never` would.
 */
function allowances(statements: readonly ts.Statement[], subject: string, ctx: FileContext) {
  const found: Allowance[] = [];
  const isSubject = (node: ts.Expression): boolean =>
    compactText(stripParentheses(node), ctx.sourceFile) === subject;
  const add = (statement: ts.Statement, expression: ts.Expression, type: ts.TypeNode): void => {
    if (type.kind === ts.SyntaxKind.NeverKeyword || !isSubject(expression)) return;
    const literals = ctx.types.literalsOf(type);
    if (literals === "not-finite") return;
    found.push({ statement, type, labels: literals.map((literal) => literal.label) });
  };
  for (const statement of alwaysRunning(statements)) {
    if (ts.isExpressionStatement(statement)) {
      let expression = stripParentheses(statement.expression);
      if (ts.isVoidExpression(expression)) expression = stripParentheses(expression.expression);
      if (ts.isSatisfiesExpression(expression)) {
        add(statement, expression.expression, expression.type);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.type !== undefined && declaration.initializer !== undefined) {
          add(statement, declaration.initializer, declaration.type);
        }
      }
    }
  }
  return found;
}

/**
 * The `case` clauses with no statements right before the `default`, which share its body
 * (`case "neutral": default:`): in the `default` the subject can still be one of them.
 */
function sharingCases(
  clause: ts.DefaultClause,
  clauses: readonly ts.CaseOrDefaultClause[],
): ts.CaseClause[] {
  const sharing: ts.CaseClause[] = [];
  for (let index = clauses.indexOf(clause) - 1; index >= 0; index -= 1) {
    const before = clauses[index];
    if (before === undefined || !ts.isCaseClause(before) || before.statements.length > 0) break;
    sharing.unshift(before);
  }
  return sharing;
}

function startsLine(text: string, position: number): boolean {
  return /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", position - 1) + 1, position));
}

/** The text's line ending. */
function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** `"a"`, `"a" and "b"`, or `the 7 cases`: the cases a title or a bullet names. */
function named(values: readonly string[]): string {
  if (values.length > 3) return `the ${String(values.length)} cases`;
  if (values.length === 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1) ?? ""}`;
}

/**
 * "Add the missing case": `case "a":` before the `default`, so the case runs the `default`'s body
 * as before, now listed. Every value takes the path it took, and the case can get its own code.
 */
function addCasesFix(clause: ts.DefaultClause, values: readonly string[], ctx: FileContext): Fix {
  const text = ctx.sourceFile.text;
  const start = clause.getStart(ctx.sourceFile);
  const eol = eolOf(text);
  const edit: TextEdit = startsLine(text, start)
    ? {
        location: { file: ctx.file, start, end: start },
        newText: values.map((value) => `case ${value}:${eol}${leadingSpace(text, start)}`).join(""),
      }
    : {
        location: { file: ctx.file, start, end: start },
        newText: values.map((value) => `case ${value}: `).join(""),
      };
  return {
    title:
      values.length === 1
        ? "Add the missing case"
        : `Add the ${String(values.length)} missing cases`,
    edits: [edit],
  };
}

/** The statement that allows `type` in the `default`. */
function allowStatement(subject: string, type: string): string {
  return `void (${subject} satisfies ${type});`;
}

/**
 * "Allow "a" in `default`": the allowing statement first in the `default`, or the cases added to
 * the one already there. Offered with the cases that share the body as the second form: core
 * takes the first that compiles.
 */
function allowFix(input: {
  clause: ts.DefaultClause;
  subject: string;
  types: readonly string[];
  title: string;
  existing: Allowance | undefined;
  ctx: FileContext;
}): Fix | undefined {
  const { clause, subject, title, existing, ctx } = input;
  const forms = input.types.map((type) => ({
    title,
    edits: [allowEdit(clause, subject, type, existing, ctx)],
  }));
  const [first, ...rest] = forms;
  if (first === undefined) return undefined;
  return rest.length === 0 ? first : { ...first, alternatives: rest };
}

function allowEdit(
  clause: ts.DefaultClause,
  subject: string,
  type: string,
  existing: Allowance | undefined,
  ctx: FileContext,
): TextEdit {
  const text = ctx.sourceFile.text;
  if (existing !== undefined) {
    const at = existing.type;
    const shown = at.getText(ctx.sourceFile);
    return {
      location: { file: ctx.file, start: at.getStart(ctx.sourceFile), end: at.end },
      newText: `${shown} | ${type}`,
    };
  }
  const statement = allowStatement(subject, type);
  const eol = eolOf(text);
  const first = clause.statements[0];
  if (first !== undefined) {
    const start = first.getStart(ctx.sourceFile);
    if (startsLine(text, start)) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      return {
        location: { file: ctx.file, start: lineStart, end: lineStart },
        newText: `${text.slice(lineStart, start)}${statement}${eol}`,
      };
    }
  }
  const colon = clause.getChildren(ctx.sourceFile).find((c) => c.kind === ts.SyntaxKind.ColonToken);
  const outer = leadingSpace(text, clause.getStart(ctx.sourceFile));
  const indent = outer + indentUnit(outer);
  const at = colon?.end ?? clause.getStart(ctx.sourceFile);
  const end = first === undefined ? at : first.getStart(ctx.sourceFile);
  const after = first === undefined ? "" : `${eol}${indent}`;
  return {
    location: { file: ctx.file, start: at, end },
    newText: `${eol}${indent}${statement}${after}`,
  };
}

/**
 * A name for a `const` holding a computed subject: the name it reads last (`alertMode` for
 * `draft.alertMode ?? "none"`, `mode` for `getMode()`), else `value`.
 */
function constName(expression: ts.Expression): string {
  const inner = stripParentheses(expression);
  if (ts.isIdentifier(inner)) return inner.text;
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
  if (ts.isBinaryExpression(inner)) return constName(inner.left);
  if (ts.isConditionalExpression(inner)) return constName(inner.whenTrue);
  if (
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isAwaitExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  ) {
    return constName(inner.expression);
  }
  if (ts.isElementAccessExpression(inner)) return constName(inner.expression);
  if (ts.isCallExpression(inner)) {
    const called = constName(inner.expression);
    const rest = /^(?:get|read|compute|to)([A-Z].*)$/.exec(called)?.[1];
    // `const read = read()` would hide the function it calls.
    return rest === undefined
      ? `${called}Value`
      : `${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  }
  return "value";
}

/** The longest code an allow bullet shows on its own line before it moves under the bullet. */
const INLINE_CODE_MAX = 70;
/** The longest example line under a bullet, without its 4 spaces of indent. */
const EXAMPLE_MAX = 92;

/**
 * The two ways out (M22): give each case its own `case`, or allow it in the `default`. Above
 * `maxHidden` the allowance comes first: a `default` for many cases often means "everything else".
 */
function fixLines(input: {
  values: readonly string[];
  subject: string;
  /** The allowing statement, or why there is none. */
  allow:
    | { kind: "statement"; type: string }
    | { kind: "ignore" }
    | { kind: "computed"; name: string; value: string };
  many: boolean;
  /** The `switch` has no `default`: the allowance adds one. */
  noDefault: boolean;
}): string {
  const { values, subject, allow, many, noDefault } = input;
  const one = values.length === 1;
  const it = one ? "it" : "them";
  // "allow it in `default`", or, without one, "add `default:` that allows it".
  const allowIt = noDefault ? `add \`default:\` that allows ${it}` : `allow ${it} in \`default\``;
  const add =
    values.length > 3
      ? "add a `case` for each, with its own code"
      : `add ${named(values.map((value) => `\`case ${value}:\``))} with ${one ? "its" : "their"} own code`;
  const allowLines = ((): string[] => {
    switch (allow.kind) {
      case "statement": {
        const code = `default: ${allowStatement(subject, allow.type)}`;
        if (code.length <= INLINE_CODE_MAX) return [`${allowIt}: \`${code}\``];
        // An example line is at most 100 characters, its indent included (M2).
        if (code.length <= EXAMPLE_MAX) return [`${allowIt}:`, `    ${code}`];
        return [`${allowIt} with \`void (${subject} satisfies …);\`, the cases joined by \`|\``];
      }
      case "ignore":
        return [
          noDefault
            ? `add \`default:\` and a comment above the \`switch\`: \`${ignoreLine(RULE_NAME)}\``
            : `allow ${it} in \`default\` with a comment above the \`switch\`: \`${ignoreLine(RULE_NAME)}\``,
        ];
      case "computed":
        return [
          fitted(
            (cut) =>
              `put the value in a \`const\` first (\`const ${allow.name} = ${cut(allow.value)}; switch (${allow.name})\`), then ${allowIt}`,
          ),
        ];
      default: {
        const unreachable: never = allow;
        return unreachable;
      }
    }
  })();
  const [allowFirst = "", ...allowRest] = allowLines;
  const ways = many
    ? [`- ${allowFirst}`, ...allowRest, `- or ${add}`]
    : [`- ${add}`, `- or ${allowFirst}`, ...allowRest];
  return ["one of", ...ways].join("\n");
}

function headline(labels: readonly string[], subject: string, maxHidden: number): string {
  return fittedCases(
    HEADLINE_MAX,
    labels,
    maxHidden,
    (cut, listed) => `\`switch\` on \`${cut(subject)}\` does not handle ${listed}`,
  );
}

/** The declared type node of what `subject` reads: a parameter's, a variable's or a property's. */
function declaredTypeNode(subject: ts.Expression, ctx: FileContext): ts.TypeNode | undefined {
  const inner = stripParentheses(subject);
  const name = ts.isPropertyAccessExpression(inner) ? inner.name : inner;
  const symbol = ctx.types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (
    declaration !== undefined &&
    (ts.isParameter(declaration) ||
      ts.isVariableDeclaration(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration))
  ) {
    return declaration.type;
  }
  return undefined;
}

/**
 * The type alias that states the union open (`type OrderStatus = OpenUnion<…>`), followed from a
 * type as written: through aliases of it, to the last one that takes no type parameters (the
 * marker itself, `OpenUnion<T>`, takes one).
 */
export function statingAlias(
  type: ts.TypeNode | undefined,
  ctx: FileContext,
  depth = 0,
): ts.TypeAliasDeclaration | undefined {
  if (type === undefined || depth > 8) return undefined;
  if (ts.isUnionTypeNode(type)) {
    for (const part of type.types) {
      const found = statingAlias(part, ctx, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (ts.isParenthesizedTypeNode(type)) return statingAlias(type.type, ctx, depth + 1);
  if (!ts.isTypeReferenceNode(type)) return undefined;
  const symbol = ctx.types.symbolAt(type.typeName);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (
    declaration === undefined ||
    !ts.isTypeAliasDeclaration(declaration) ||
    declaration.typeParameters !== undefined ||
    !ctx.types.guaranteesOf(declaration.type).includes(OPEN_UNION)
  ) {
    return undefined;
  }
  return statingAlias(declaration.type, ctx, depth + 1) ?? declaration;
}

/**
 * The type alias that states the union a value is open (`OrderStatus`), whichever way the value
 * got its type: the declared type of what it reads, else the alias TypeScript keeps on its type
 * (a destructured field, a `const` without a type, a call's result, an alias imported through an
 * index file). The same in `check` and in the summary `stateward guarantees` lists from, so a
 * finding about a switch always names the union its listing covers.
 */
export function openAliasOf(
  subject: ts.Expression,
  ctx: FileContext,
): ts.TypeAliasDeclaration | undefined {
  const declared = statingAlias(declaredTypeNode(subject, ctx), ctx);
  if (declared !== undefined) return declared;
  const declaration = ctx.types.typeAliasOf(subject)?.declaration;
  if (
    declaration === undefined ||
    declaration.typeParameters !== undefined ||
    !ctx.types.guaranteesOf(declaration.type).includes(OPEN_UNION)
  ) {
    return undefined;
  }
  return statingAlias(declaration.type, ctx) ?? declaration;
}

/** `status` for `order.status`: what "an unknown …" names. */
function lastName(subject: ts.Expression): string {
  const inner = stripParentheses(subject);
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
  return ts.isIdentifier(inner) ? inner.text : "value";
}

/** The place an open union is stated, as a summary keeps it. */
function placeOf(node: ts.Node): { file: string; start: number; end: number } {
  return { file: node.getSourceFile().fileName, start: node.getStart(), end: node.getEnd() };
}

type Settings = { maxHidden: number; projectTypesOnly: boolean; ignore: readonly string[] };

export const nonExhaustiveSwitch = defineRule({
  kind: "file",
  meta: {
    description:
      "Every `switch` over a union handles every case: a `switch` without a `default` lists them all, and a `default` handles only the cases it allows, so a case added later is reported where it is not handled.",
    summary:
      "a `switch` over a union that misses a case, or whose `default` handles a case nobody allowed",
    defaultSeverity: "error",
    tier: "core",
    group: "cases",
    fixNeedsStrictNulls: true,
    options: {
      maxHidden: option.number({
        default: 5,
        min: 0,
        integer: true,
        description:
          'A `default` that handles more cases than this, none allowed, or a `switch` without one that misses more, is reported as info: it often means "everything else".',
      }),
      ignore: option.strings({
        default: [],
        description:
          "Union type names (globs like *Event) whose switches are not checked: matched against the type of the value tested, or of the object whose tag is tested.",
      }),
      severities: option.severities({
        kinds: {
          hidden: "the default handles up to maxHidden cases it does not allow",
          "many-hidden":
            "the default handles more than maxHidden cases it does not allow (info unless set here)",
          missing:
            "a switch without a default does not list up to maxHidden cases (TypeScript reports the rest when a function must return a value)",
          "many-missing":
            "a switch without a default does not list more than maxHidden cases (info unless set here)",
          open: "a switch over an open union (`OpenUnion<T>`) has no default",
        },
        description: "A severity per kind of finding.",
      }),
      projectTypesOnly: option.boolean({
        default: true,
        description:
          "Check only unions declared in the project, not in packages or TypeScript's lib: a member a library adds later is not a state the app designed.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const settings: Settings = {
      maxHidden: ctx.options.maxHidden,
      projectTypesOnly: ctx.options.projectTypesOnly,
      ignore: ctx.options.ignore,
    };
    const visit = (node: ts.Node): void => {
      if (ts.isSwitchStatement(node)) checkSwitch(node, settings, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
  summarize(ctx): Json | undefined {
    return openSummary(ctx);
  },
});

/**
 * The open unions this file states, and its switches over one: what `stateward guarantees`, hover
 * and code lens list. Undefined when the file has neither.
 */
function openSummary(ctx: FileContext): OpenSummary | undefined {
  const declared: OpenSummary["declared"] = [];
  const switches: OpenSummary["switches"] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeAliasDeclaration(node) &&
      node.typeParameters === undefined &&
      ctx.types.guaranteesOf(node.type).includes(OPEN_UNION) &&
      statingAlias(node.type, ctx) === undefined
    ) {
      declared.push({ name: node.name.text, ...placeOf(node) });
    }
    if (ts.isSwitchStatement(node)) {
      const subject = stripParentheses(node.expression);
      if (ctx.types.guaranteesOf(subject).includes(OPEN_UNION)) {
        const alias = openAliasOf(subject, ctx);
        if (alias !== undefined) {
          const at = placeOf(alias);
          // The whole statement: a finding anywhere in it is about this switch.
          switches.push({ ...placeOf(node), id: `${at.file}#${String(at.start)}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return declared.length === 0 && switches.length === 0 ? undefined : { declared, switches };
}

/** A `switch` over an open union without a `default`: a value the union does not list goes nowhere. */
function checkOpen(
  node: ts.SwitchStatement,
  subject: ts.Expression,
  stated: readonly RelatedNote[],
  ctx: FileContext,
): void {
  const alias = openAliasOf(subject, ctx);
  const shown = oneLineText(subject, ctx.sourceFile);
  const union = alias?.name.text ?? ctx.types.typeTextOf(subject);
  ctx.report({
    node: node.getFirstToken(ctx.sourceFile) ?? node,
    message: fitted(
      (cut) =>
        `\`switch\` on \`${cut(shown)}\` does not handle a value outside \`${cut(union)}\`, which is open`,
    ),
    hint: `add \`default:\` that handles an unknown ${lastName(subject)}`,
    findingKind: "open",
    related: stated,
  });
}

/** How the fix line allows the cases: the statement, an ignore comment, or a `const` first. */
type AllowWay =
  | { kind: "statement"; type: string }
  | { kind: "ignore" }
  | { kind: "computed"; name: string; value: string };

function allowanceOf(subject: ts.Expression, shown: string, type: string | undefined): AllowWay {
  if (!isPlainReference(subject)) {
    return {
      kind: "computed",
      name: constName(subject),
      value:
        ts.isBinaryExpression(subject) && subject.operatorToken.kind === ts.SyntaxKind.CommaToken
          ? `(${shown})`
          : shown,
    };
  }
  return type === undefined ? { kind: "ignore" } : { kind: "statement", type };
}

/** The note at the declaration of the open union a switch tests, when the declaration is found. */
function statedNote(subject: ts.Expression, ctx: FileContext): RelatedNote[] {
  const alias = openAliasOf(subject, ctx);
  return alias === undefined
    ? []
    : [{ node: alias, message: `\`${alias.name.text}\` is stated open (\`OpenUnion\`)` }];
}

type RelatedNote = { node: ts.Node; message: string };

/** Whether a statement ends its clause: control never reaches the statement after it. */
function endsClause(statements: readonly ts.Statement[]): boolean {
  const last = statements.at(-1);
  if (last === undefined) return false;
  if (ts.isBlock(last)) return endsClause(last.statements);
  return (
    ts.isReturnStatement(last) ||
    ts.isThrowStatement(last) ||
    ts.isBreakStatement(last) ||
    ts.isContinueStatement(last)
  );
}

/**
 * Where code added after the last clause goes, and how it is laid out: at the end of the last
 * clause's line (a comment after it stays on its line), indented as that clause and its body. On
 * a `switch` written on one line, inline.
 */
function endOfSwitch(node: ts.SwitchStatement, ctx: FileContext) {
  const text = ctx.sourceFile.text;
  const clauses = node.caseBlock.clauses;
  const last = clauses[clauses.length - 1];
  const eol = eolOf(text);
  const lineEnd = text.indexOf("\n", last?.end ?? 0);
  const rest = lineEnd === -1 ? "" : text.slice(last?.end ?? 0, lineEnd).replace(/\r$/, "");
  const ownLines =
    last !== undefined &&
    startsLine(text, last.getStart(ctx.sourceFile)) &&
    lineEnd !== -1 &&
    lineEnd < node.caseBlock.getEnd() - 1 &&
    /^[ \t]*(?:\/\/.*)?$/.test(rest);
  const at =
    last === undefined
      ? node.caseBlock.getEnd() - 1
      : ownLines
        ? lineEnd - (text[lineEnd - 1] === "\r" ? 1 : 0)
        : last.end;
  const caseIndent = last === undefined ? "" : leadingSpace(text, last.getStart(ctx.sourceFile));
  const first = last?.statements[0];
  const bodyIndent =
    first !== undefined && startsLine(text, first.getStart(ctx.sourceFile))
      ? leadingSpace(text, first.getStart(ctx.sourceFile))
      : caseIndent + indentUnit(caseIndent);
  // The last clause runs on into what is added unless it ends: a `break;` keeps it as it was.
  const needsBreak =
    last !== undefined && last.statements.length > 0 && !endsClause(last.statements);
  const line = (indent: string, code: string): string =>
    ownLines ? `${eol}${indent}${code}` : ` ${code}`;
  return {
    at,
    needsBreak,
    caseLine: (code: string) => line(caseIndent, code),
    bodyLine: (code: string) => line(bodyIndent, code),
  };
}

/** "Add the missing case" without a `default`: `case "a": break;` after the last clause. */
function addCasesAtEnd(node: ts.SwitchStatement, values: readonly string[], ctx: FileContext): Fix {
  const end = endOfSwitch(node, ctx);
  const newText = [
    end.needsBreak ? end.bodyLine("break;") : "",
    ...values.map((value) => end.caseLine(`case ${value}:`)),
    end.bodyLine("break;"),
  ].join("");
  return {
    title:
      values.length === 1
        ? "Add the missing case"
        : `Add the ${String(values.length)} missing cases`,
    edits: [{ location: { file: ctx.file, start: end.at, end: end.at }, newText }],
  };
}

/** "Allow "a" in `default`" without a `default`: one after the last clause, that allows them. */
function addDefaultAtEnd(input: {
  node: ts.SwitchStatement;
  subject: string;
  types: readonly string[];
  title: string;
  ctx: FileContext;
}): Fix | undefined {
  const { node, subject, title, ctx } = input;
  const end = endOfSwitch(node, ctx);
  const forms = input.types.map((type): Fix => ({
    title,
    edits: [
      {
        location: { file: ctx.file, start: end.at, end: end.at },
        newText: [
          end.needsBreak ? end.bodyLine("break;") : "",
          end.caseLine("default:"),
          end.bodyLine(allowStatement(subject, type)),
        ].join(""),
      },
    ],
  }));
  const [first, ...rest] = forms;
  if (first === undefined) return undefined;
  return rest.length === 0 ? first : { ...first, alternatives: rest };
}

/** The clauses with no statements at the end of the `switch`: a `default` added after them shares their values. */
function trailingEmptyCases(clauses: readonly ts.CaseOrDefaultClause[]): ts.CaseClause[] {
  const found: ts.CaseClause[] = [];
  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index];
    if (clause === undefined || !ts.isCaseClause(clause) || clause.statements.length > 0) break;
    found.unshift(clause);
  }
  return found;
}

/**
 * The function whose end the end of `node` reaches: `node` is the last statement of the body, or
 * of a block, branch or `try` that is. Undefined when code after it runs first.
 */
function tailFunction(node: ts.Statement): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node = node;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (ts.isBlock(parent)) {
      const last = parent.statements.filter((statement) => !isDeclarationOnly(statement)).at(-1);
      if (last !== current) return undefined;
      const owner = parent.parent;
      if (ts.isFunctionLike(owner) && "body" in owner && owner.body === parent) {
        return ts.isFunctionDeclaration(owner) ||
          ts.isMethodDeclaration(owner) ||
          ts.isFunctionExpression(owner) ||
          ts.isArrowFunction(owner) ||
          ts.isGetAccessorDeclaration(owner)
          ? owner
          : undefined;
      }
      current = parent;
    } else if (ts.isIfStatement(parent) && current !== parent.expression) {
      current = parent;
    } else if (ts.isLabeledStatement(parent)) {
      current = parent;
    } else if (ts.isCatchClause(parent)) {
      current = parent.parent;
    } else if (ts.isTryStatement(parent) && current === parent.tryBlock) {
      current = parent;
    } else {
      return undefined;
    }
  }
}

/** A statement that runs no code where it stands: a function, type or interface declaration. */
function isDeclarationOnly(statement: ts.Statement): boolean {
  return (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  );
}

/**
 * A `switch` without a `default` that does not list every case: the value of a missing case runs
 * none of its code. Not reported when TypeScript already reports it: the end of the `switch` is
 * the end of a function that must return a value (TS2366, TS7030).
 */
function checkMissing(input: {
  node: ts.SwitchStatement;
  subject: ts.Expression;
  literals: readonly Literal[];
  covered: ReadonlySet<string>;
  stated: readonly RelatedNote[];
  settings: Settings;
  ctx: FileContext;
}): void {
  const { node, subject, literals, covered, stated, settings, ctx } = input;
  const clauses = node.caseBlock.clauses;
  // `switch (mode) {}` tests nothing.
  if (clauses.length === 0) return;
  const hidden = literals.filter((literal) => !covered.has(literal.label));
  if (hidden.length === 0) return;
  const fn = tailFunction(node);
  if (fn !== undefined && ctx.types.reportsReachableEnd(fn)) return;
  const shown = oneLineText(subject, ctx.sourceFile);
  const labels = hidden.map((literal) => literal.label);
  const many = hidden.length > settings.maxHidden;
  const spellings = enumSpellings(
    clauses.filter(ts.isCaseClause).map((c) => c.expression),
    ctx,
  );
  const codes = labels.map((label) => valueCode(label, spellings));
  const values = codes.every((code) => code !== undefined) ? codes : undefined;
  const type = restType({ hidden: labels, spellings });
  const every = literals.map((literal) => valueCode(literal.label, spellings));
  const allCodes = every.every((code) => code !== undefined) ? every : undefined;
  const allow = allowanceOf(subject, shown, type);
  const fixes: Fix[] = [];
  if (values !== undefined) fixes.push(addCasesAtEnd(node, values, ctx));
  if (allow.kind === "statement") {
    const sharing = trailingEmptyCases(clauses).map((clause) =>
      oneLineText(clause.expression, ctx.sourceFile),
    );
    const fix = addDefaultAtEnd({
      node,
      subject: shown,
      types: [
        ...new Set([
          allow.type,
          [...sharing, allow.type].join(" | "),
          ...(allCodes === undefined ? [] : [allCodes.join(" | ")]),
        ]),
      ],
      title: `Allow ${named(values ?? labels)} in \`default\``,
      ctx,
    });
    if (fix !== undefined) fixes.push(fix);
  }
  ctx.report({
    node: node.getFirstToken(ctx.sourceFile) ?? node,
    message: headline(labels, shown, settings.maxHidden),
    hint: fixLines({ values: values ?? labels, subject: shown, allow, many, noDefault: true }),
    ...(many
      ? { findingKind: "many-missing", severity: "info" as const }
      : { findingKind: "missing" }),
    related: stated,
    ...(fixes.length === 0 ? {} : { fixes }),
  });
}

function checkSwitch(node: ts.SwitchStatement, settings: Settings, ctx: FileContext): void {
  const clauses = node.caseBlock.clauses;
  const subject = stripParentheses(node.expression);
  // `typeof x` gives the names of types, and `switch (true)` tests conditions: neither has cases
  // that are values of a union.
  if (ts.isTypeOfExpression(subject)) return;
  if (subject.kind === ts.SyntaxKind.TrueKeyword || subject.kind === ts.SyntaxKind.FalseKeyword)
    return;
  const literals = ctx.types.literalsOf(subject);
  if (literals === "not-finite") return;
  if (ignoredType(subject, settings.ignore, ctx)) return;
  const open = ctx.types.guaranteesOf(subject).includes(OPEN_UNION);
  const stated = open ? statedNote(subject, ctx) : [];
  const fallback = clauses.find(ts.isDefaultClause);
  if (fallback === undefined && open) checkOpen(node, subject, stated, ctx);
  // A member a package adds in a later version is not a state the app designed; an open union is
  // stated by the project, wherever its members come from.
  if (!open && settings.projectTypesOnly && ctx.types.isLibraryType(subject)) return;
  const covered = coveredLabels(clauses, ctx);
  if (covered === undefined) return;
  if (fallback === undefined) {
    checkMissing({ node, subject, literals, covered, stated, settings, ctx });
    return;
  }
  const subjectText = compactText(subject, ctx.sourceFile);
  const allowed = allowances(fallback.statements, subjectText, ctx);
  const allowedLabels = new Set(allowed.flatMap((allowance) => allowance.labels));
  const hidden = literals.filter(
    (literal) => !covered.has(literal.label) && !allowedLabels.has(literal.label),
  );
  // Every case is listed or allowed: the `default` handles only what it says, if anything.
  if (hidden.length === 0) return;
  // TypeScript leaves `undefined` in `o?.kind` after every case, even `case undefined`, unless `o`
  // itself is narrowed: no allowance compiles, so a finding would have no fix.
  if (
    proofTarget(subject, ctx) === subject &&
    ts.isOptionalChain(subject) &&
    hidden.some((literal) => literal.value === undefined)
  ) {
    return;
  }
  const shown = oneLineText(subject, ctx.sourceFile);
  const labels = hidden.map((literal) => literal.label);
  const many = hidden.length > settings.maxHidden;
  const spellings = enumSpellings(
    clauses.filter(ts.isCaseClause).map((c) => c.expression),
    ctx,
  );
  const codes = labels.map((label) => valueCode(label, spellings));
  const values = codes.every((code) => code !== undefined) ? codes : undefined;
  const type = restType({ hidden: labels, spellings });
  const every = literals.map((literal) => valueCode(literal.label, spellings));
  const allCodes = every.every((code) => code !== undefined) ? every : undefined;
  const where = fallback.getFirstToken(ctx.sourceFile) ?? fallback;
  const kind = many
    ? { findingKind: "many-hidden", severity: "info" as const }
    : { findingKind: "hidden" };
  const allow = allowanceOf(subject, shown, type);
  const hint = fixLines({
    values: values ?? labels,
    subject: shown,
    allow,
    many,
    noDefault: false,
  });
  const fixes: Fix[] = [];
  if (values !== undefined) fixes.push(addCasesFix(fallback, values, ctx));
  if (allow.kind === "statement") {
    const sharing = sharingCases(fallback, clauses).map((clause) =>
      oneLineText(clause.expression, ctx.sourceFile),
    );
    const [existing] = allowed;
    const fix = allowFix({
      clause: fallback,
      subject: shown,
      // The cases that reach the `default` by falling through are in its type too: with them, then
      // with every case of the union, as the forms core tries after the plain one.
      types: [
        ...new Set([
          allow.type,
          [...sharing, allow.type].join(" | "),
          ...(allCodes === undefined ? [] : [allCodes.join(" | ")]),
        ]),
      ],
      title: `Allow ${named(values ?? labels)} in \`default\``,
      existing,
      ctx,
    });
    if (fix !== undefined) fixes.push(fix);
  }
  ctx.report({
    node: where,
    message: headline(labels, shown, settings.maxHidden),
    hint,
    ...kind,
    related: stated,
    ...(fixes.length === 0 ? {} : { fixes }),
  });
}
