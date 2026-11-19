import ts from "@stateward/core/typescript";
import {
  defineRule,
  isSafePlatformCall,
  option,
  type FileContext,
  type Fix,
  type Json,
  type LedgerRef,
  type Literal,
  type ReadOutcome,
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
  namesInFile,
  typeCode,
  unspelledEnums,
  stripParentheses,
  valueCode,
  enumParts,
} from "./cases.js";
import { EXPLAIN } from "./non-exhaustive-switch.explain.js";
import { OPEN_UNION, type OpenSummary } from "./open-union.js";
import { HEADLINE_MAX, compactText, fitted, fittedCases, oneLineText } from "./text.js";

export const RULE_NAME = "non-exhaustive-switch";

/**
 * The labels the case clauses cover, or undefined when a case is not one literal (`case other:` with
 * `other: string`): then the switch cannot be judged. `literals` are the cases of the subject.
 */
function coveredLabels(
  clauses: readonly ts.CaseOrDefaultClause[],
  literals: readonly Literal[],
  ctx: FileContext,
): Set<string> | undefined {
  const covered = new Set<string>();
  for (const clause of clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const cases = ctx.types.literalsOf(clause.expression);
    // A case whose type is several literals (`case mode:`) matches only one of them at run time.
    const [only] = cases === "not-finite" ? [] : cases;
    if (only === undefined || cases.length !== 1) return undefined;
    covered.add(only.label);
    // `case Status.Issued` over `"issued" | …`: TypeScript narrows by the value, so the member also
    // covers the plain literal it equals (Infisical, user trial 1.0.2).
    const plain = plainLabel(only.value);
    if (plain === undefined) continue;
    covered.add(plain);
    // `case "person":` over an enum with `Person = "person"`: TypeScript does not narrow, but at
    // run time the case handles that member.
    if (only.label !== plain) continue;
    for (const member of literals) if (member.value === only.value) covered.add(member.label);
  }
  return covered;
}

/**
 * The cases that name an enum member by its value (`case "person":` for `PERSON = "person"`): they
 * run as the member's case, but TypeScript does not narrow an enum by its value, so it cannot check
 * the `switch`. Each with the member it matches.
 */
function valueCases(
  clauses: readonly ts.CaseOrDefaultClause[],
  literals: readonly Literal[],
  ctx: FileContext,
): { expression: ts.Expression; member: string }[] {
  const found: { expression: ts.Expression; member: string }[] = [];
  for (const clause of clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const cases = ctx.types.literalsOf(clause.expression);
    const [only] = cases === "not-finite" ? [] : cases;
    if (only === undefined || cases.length !== 1 || only.label !== plainLabel(only.value)) continue;
    const member = literals.find(
      (literal) => literal.value === only.value && literal.label !== only.label,
    );
    if (member !== undefined) found.push({ expression: clause.expression, member: member.label });
  }
  return found;
}

/**
 * The code that names an enum member in this file: `Role.Admin` when the file declares `Role` or
 * imports it as a value, `R.Admin` for `import { Role as R }`. Undefined when the file has no value
 * for the enum (not imported, or imported with `import type`).
 */
function memberCode(label: string, sourceFile: ts.SourceFile): string | undefined {
  const parts = enumParts(label);
  if (parts === undefined) return undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isEnumDeclaration(statement) && statement.name.text === parts.owner) return label;
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === parts.owner && !element.isTypeOnly) {
        return `${element.name.text}.${parts.member}`;
      }
    }
  }
  return undefined;
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
  /** Enums the code never writes a member of: a `case` for one needs it imported as a value. */
  imports: readonly string[];
}): string {
  const { values, subject, allow, many, noDefault, imports } = input;
  const needs =
    imports.length === 0
      ? ""
      : ` (with ${named(imports.map((owner) => `\`${owner}\``))} imported as a value)`;
  const one = values.length === 1;
  const it = one ? "it" : "them";
  // "allow it in `default`", or, without one, "add `default:` that allows it".
  const allowIt = noDefault ? `add \`default:\` that allows ${it}` : `allow ${it} in \`default\``;
  const add =
    values.length > 3
      ? `add a \`case\` for each, with its own code${needs}`
      : `add ${named(values.map((value) => `\`case ${value}:\``))} with ${one ? "its" : "their"} own code${needs}`;
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

/** For a `default` that takes cases no `case` names: it does handle them, so the headline says what it takes. */
function takenHeadline(labels: readonly string[], subject: string, maxHidden: number): string {
  return fittedCases(
    HEADLINE_MAX,
    labels,
    maxHidden,
    (cut, listed) =>
      `the \`default\` of the \`switch\` on \`${cut(subject)}\` takes ${listed}, which no \`case\` names`,
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
  const tagged = openObjectOf(subject, ctx);
  if (tagged !== undefined) return openAliasOf(tagged, ctx);
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

/**
 * The object whose tag a subject reads (`part` in `part.kind`, `part["kind"]`) when that object's
 * type is a union stated open: `type Part = OpenUnion<A | B | Generic>`. The checker keeps the
 * statement in the type, so it is read from the type, wherever the object got it.
 */
export function openObjectOf(subject: ts.Expression, ctx: FileContext): ts.Expression | undefined {
  const inner = stripParentheses(subject);
  const object = ts.isPropertyAccessExpression(inner)
    ? inner.expression
    : ts.isElementAccessExpression(inner) && ts.isStringLiteral(inner.argumentExpression)
      ? inner.expression
      : undefined;
  return object !== undefined && ctx.types.guaranteesOf(object).includes(OPEN_UNION)
    ? object
    : undefined;
}

/** Whether a switch subject is a union stated open, or the tag of an object that is. */
function isOpenSubject(subject: ts.Expression, ctx: FileContext): boolean {
  return (
    ctx.types.guaranteesOf(subject).includes(OPEN_UNION) || openObjectOf(subject, ctx) !== undefined
  );
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
    proves: { flows: { decided: [OPEN_UNION] } },
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
          "Union type names (globs like *Event) whose switches are not checked: matched against the type of the value tested, or of the object whose tag is tested. A union stated open (`OpenUnion<T>`) is always checked: no setting silences a stated guarantee.",
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
          "open-throws":
            "the default of a switch over an open union only throws (or calls a function that returns `never` or always throws, or rejects), or only checks the value against `never`, so it handles no value outside the union",
          "enum-value":
            'a case names an enum member by its value (`case "person":`), which TypeScript does not check (info unless set here)',
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
    for (const chain of uncheckedChains(ctx)) {
      ctx.unknown({
        node: chain.node,
        message: `not checked: ${chain.reason}`,
        hint: "use a `switch` with a `default` that handles a value outside the union: a chain is not read as a switch, even with an `else`",
      });
    }
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
    markDecidedFlows(ctx);
  },
  summarize(ctx): Json | undefined {
    return openSummary(ctx);
  },
});

/** The expression that starts and ends where a flow of the ledger does. */
function expressionAt(sourceFile: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || node.end < end || node.pos > start) return;
    if (node.getStart(sourceFile) === start && node.end === end && ts.isExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Up from a comparison through `(…)`, `!`, `&&` and `||`: the node whose condition it is part of. */
function conditionOwner(comparison: ts.Node): { owner: ts.Node; condition: ts.Node } {
  let condition = comparison;
  for (;;) {
    const parent = condition.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))
    ) {
      condition = parent;
      continue;
    }
    return { owner: parent, condition };
  }
}

/**
 * What the proof says of a value of a union stated open that the code decides by (a `decided`
 * flow of the reference ledger): the subject of a `switch` is read (the checks above judge the
 * switch); any other way to decide by it is not read as a switch, so it is not checked: a
 * `switch (true)`, a `?:` chain, an `if` or an `if` chain, a comparison kept in a value, a lookup
 * by the value, an `in` test.
 */
function decidedOutcome(ref: LedgerRef, node: ts.Node, ctx: FileContext): ReadOutcome {
  let at = node;
  while (ts.isParenthesizedExpression(at.parent) || ts.isNonNullExpression(at.parent)) {
    at = at.parent;
  }
  const parent = at.parent;
  const value = oneLineText(node, ctx.sourceFile);
  const notRead = (what: string, hint = "use a `switch` with a `default`"): ReadOutcome => ({
    kind: "unchecked",
    reason: `${what} is not read as a switch: ${hint}`,
  });
  if (ref.via === "derived") {
    return notRead(
      `\`${value}\`, a value made from the union,`,
      "switch on the value itself, with a `default`",
    );
  }
  if (ref.via === "call") {
    return notRead(`\`${ref.text}\`, a call that decides by \`${value}\`,`);
  }
  if (ts.isSwitchStatement(parent) && parent.expression === at) return { kind: "decided" };
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === at) {
    // `labels[s] ?? s`: a key the table does not have gets the fallback.
    let lookup: ts.Node = parent;
    while (ts.isParenthesizedExpression(lookup.parent)) lookup = lookup.parent;
    const outer = lookup.parent;
    if (
      ts.isBinaryExpression(outer) &&
      outer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      outer.left === lookup
    ) {
      // The fallback must hand a value back: `labels[s] ?? fail(s)` throws instead.
      const throwing = throwingPart([outer.right], ctx);
      if (throwing === undefined) return { kind: "decided" };
      return notRead(
        `the lookup \`${oneLineText(parent, ctx.sourceFile)}\` by \`${value}\`, whose fallback \`${oneLineText(throwing, ctx.sourceFile)}\` can throw,`,
        "give it a fallback value for a value the table does not have, or use a `switch`",
      );
    }
    return notRead(
      `the lookup \`${oneLineText(parent, ctx.sourceFile)}\` by \`${value}\``,
      "give it a fallback (`?? …`) for a value the table does not have, or use a `switch`",
    );
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword) {
    return notRead(`the \`in\` test \`${oneLineText(parent, ctx.sourceFile)}\``);
  }
  if (ts.isBinaryExpression(parent)) {
    const { owner, condition } = conditionOwner(parent);
    if (ts.isCaseClause(owner) && owner.expression === condition) {
      const subject = oneLineText(owner.parent.parent.expression, ctx.sourceFile);
      return notRead(`the \`switch (${subject})\` on \`${value}\``);
    }
    if (ts.isConditionalExpression(owner) && owner.condition === condition) {
      return notRead(`the \`?:\` on \`${value}\``);
    }
    if (ts.isIfStatement(owner) && owner.expression === condition) {
      const chain =
        owner.elseStatement !== undefined ||
        (ts.isIfStatement(owner.parent) && owner.parent.elseStatement === owner);
      return notRead(`the \`if\`${chain ? " chain" : ""} on \`${value}\``);
    }
    return notRead(`the comparison \`${oneLineText(parent, ctx.sourceFile)}\``);
  }
  return notRead(`\`${ref.text}\``);
}

/** Marks every reference to a union stated open: its names, and the values the code decides by. */
function markDecidedFlows(ctx: FileContext): void {
  for (const ref of ctx.ledger) {
    if (ref.trait !== OPEN_UNION) continue;
    if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
      ctx.read(ref, { kind: "irrelevant" });
      continue;
    }
    const node =
      ref.form === "decided"
        ? expressionAt(ctx.sourceFile, ref.location.start, ref.location.end)
        : undefined;
    ctx.read(
      ref,
      node === undefined
        ? {
            kind: "unchecked",
            reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read: decide by the value in a \`switch\` with a \`default\``,
          }
        : decidedOutcome(ref, node, ctx),
    );
  }
}

/** The comparisons in a condition whose operand is an open value, through `&&`, `||`, `!` and `(…)`. */
function openOperand(condition: ts.Expression, ctx: FileContext): ts.Expression | undefined {
  const inner = stripParentheses(condition);
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken) {
    return openOperand(inner.operand, ctx);
  }
  if (!ts.isBinaryExpression(inner)) return undefined;
  const operator = inner.operatorToken.kind;
  if (
    operator === ts.SyntaxKind.AmpersandAmpersandToken ||
    operator === ts.SyntaxKind.BarBarToken
  ) {
    return openOperand(inner.left, ctx) ?? openOperand(inner.right, ctx);
  }
  const compares =
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken;
  if (!compares) return undefined;
  return [inner.left, inner.right].map(stripParentheses).find((side) => isOpenSubject(side, ctx));
}

/**
 * The `if` chains over an open value that are not proven: an `if … else if …` (or `if … else`)
 * whose conditions compare an open value, and that does not end in an `else` that handles one (an
 * `else` that only throws handles nothing). A lone `if` is a condition, not a chain. A chain is
 * not read as a switch, so the union is "not checked" there.
 */
function uncheckedChains(ctx: FileContext): { node: ts.IfStatement; id: string; reason: string }[] {
  const found: { node: ts.IfStatement; id: string; reason: string }[] = [];
  const visit = (node: ts.Node): void => {
    const isFirst =
      ts.isIfStatement(node) &&
      !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node);
    if (ts.isIfStatement(node) && isFirst && node.elseStatement !== undefined) {
      let last: ts.IfStatement = node;
      let subject = openOperand(node.expression, ctx);
      while (last.elseStatement !== undefined && ts.isIfStatement(last.elseStatement)) {
        last = last.elseStatement;
        subject ??= openOperand(last.expression, ctx);
      }
      const ending = last.elseStatement;
      const handled =
        ending !== undefined && !onlyThrows(ts.isBlock(ending) ? ending.statements : [ending], ctx);
      const alias = subject === undefined ? undefined : openAliasOf(subject, ctx);
      if (subject !== undefined && alias !== undefined && !handled) {
        const at = placeOf(alias);
        found.push({
          node,
          id: `${at.file}#${String(at.start)}`,
          reason: `the \`if\` chain on \`${oneLineText(subject, ctx.sourceFile)}\` is not read as a switch, and it has no \`else\` that handles a value outside \`${alias.name.text}\`: use a \`switch\` with a \`default\``,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

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
      if (isOpenSubject(subject, ctx)) {
        const alias = openAliasOf(subject, ctx);
        if (alias !== undefined) {
          const at = placeOf(alias);
          // The whole statement: a finding anywhere in it is about this switch.
          switches.push({ ...placeOf(node), id: `${at.file}#${String(at.start)}` });
        }
      }
    }
    // `labels[s] ?? fallback`: a value the table does not have gets the fallback.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const lookup = stripParentheses(node.left);
      const key = ts.isElementAccessExpression(lookup)
        ? stripParentheses(lookup.argumentExpression)
        : undefined;
      const alias =
        key !== undefined && isOpenSubject(key, ctx) ? openAliasOf(key, ctx) : undefined;
      if (alias !== undefined) {
        const at = placeOf(alias);
        switches.push({ ...placeOf(node), id: `${at.file}#${String(at.start)}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  const chains = uncheckedChains(ctx).map(({ node, id, reason }) => ({
    ...placeOf(node),
    id,
    reason,
  }));
  return declared.length === 0 && switches.length === 0 && chains.length === 0
    ? undefined
    : { declared, switches, ...(chains.length === 0 ? {} : { chains }) };
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
        `\`switch\` on \`${cut(shown)}\` has no \`default\` for a value outside \`${cut(union)}\`, which is open`,
    ),
    hint: `add \`default:\` that handles an unknown ${lastName(subject)}`,
    findingKind: "open",
    against: true,
    related: stated,
  });
}

/** Whether a call is typed `never`: it never returns (`assertNever(s)`). */
function callsNever(expression: ts.Expression, ctx: FileContext): boolean {
  let inner = stripParentheses(expression);
  while (ts.isAwaitExpression(inner)) inner = stripParentheses(inner.expression);
  return ts.isCallExpression(inner) && ctx.types.typeTextOf(inner) === "never";
}

/** A `return` in the statements that gives a value back (not a `never` call), not in a nested function. */
function returnsValue(statements: readonly ts.Statement[], ctx: FileContext): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      !neverReturns(node.expression, ctx)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  return found;
}

/**
 * Whether a clause handles no value: it ends in a `throw` or a call that returns `never`
 * (`assertNever(s)`), and gives nothing back on the way. A value the union does not list then
 * stops the program instead of being handled.
 */
export function onlyThrows(statements: readonly ts.Statement[], ctx: FileContext): boolean {
  const { kind } = endingOf(statements, ctx);
  return kind === "throws" || kind === "never";
}

/** The statements of a clause without `break`s and empty ones, a lone block opened. */
function keptStatements(statements: readonly ts.Statement[]): readonly ts.Statement[] {
  const kept = statements.filter((one) => !ts.isBreakStatement(one) && !ts.isEmptyStatement(one));
  const [only] = kept;
  return kept.length === 1 && only !== undefined && ts.isBlock(only)
    ? keptStatements(only.statements)
    : kept;
}

/**
 * Whether a clause only checks the value against `never` (`const unreachable: never = s;`, then
 * perhaps `return unreachable;`): TypeScript checks the cases with it, but at run time a value the
 * union does not list goes through it unhandled.
 */
function onlyChecksNever(statements: readonly ts.Statement[], ctx: FileContext): boolean {
  const kept = keptStatements(statements);
  const declares = (one: ts.Statement): boolean =>
    ts.isVariableStatement(one) &&
    one.declarationList.declarations.every(
      (declaration) => declaration.type?.kind === ts.SyntaxKind.NeverKeyword,
    );
  const givesNever = (one: ts.Statement): boolean =>
    (ts.isReturnStatement(one) || ts.isExpressionStatement(one)) &&
    one.expression !== undefined &&
    ts.isIdentifier(stripParentheses(one.expression)) &&
    ctx.types.typeTextOf(one.expression) === "never";
  return kept.some(declares) && kept.every((one) => declares(one) || givesNever(one));
}

/** The function a call reaches, when the project declares it with a body: a function, an arrow, an object's or a class's method. */
function calledFunction(
  call: ts.CallExpression,
  ctx: FileContext,
): ts.FunctionLikeDeclaration | undefined {
  const callee = stripParentheses(call.expression);
  // A function written and called in place: `(() => { … })()`.
  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) return callee;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(name)) return undefined;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return undefined;
  const node = declared.node;
  const fn =
    (ts.isVariableDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node)) &&
    node.initializer !== undefined
      ? stripParentheses(node.initializer)
      : node;
  return ts.isFunctionDeclaration(fn) ||
    ts.isFunctionExpression(fn) ||
    ts.isArrowFunction(fn) ||
    ts.isMethodDeclaration(fn)
    ? fn
    : undefined;
}

/**
 * Whether a call always throws: a function of the project (a function, an arrow, an object's or a
 * class's method, one written and called in place) whose body ends in a `throw` and has no
 * `return` (`function fail(m: string): void { throw new Error(m); }`), whatever its return type
 * says.
 */
function alwaysThrows(expression: ts.Expression, ctx: FileContext): boolean {
  let inner = stripParentheses(expression);
  while (ts.isAwaitExpression(inner)) inner = stripParentheses(inner.expression);
  if (!ts.isCallExpression(inner)) return false;
  const fn = calledFunction(inner, ctx);
  const body = fn?.body;
  if (body === undefined || !ts.isBlock(body)) return false;
  const last = body.statements.at(-1);
  if (last === undefined || !ts.isThrowStatement(last)) return false;
  let returns = false;
  const visit = (child: ts.Node): void => {
    if (returns || ts.isFunctionLike(child)) return;
    if (ts.isReturnStatement(child)) {
      returns = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  for (const statement of body.statements) visit(statement);
  return !returns;
}

/** Whether a call never gives a value back: typed `never`, or a function of the project that always throws. */
function neverReturns(expression: ts.Expression, ctx: FileContext): boolean {
  return callsNever(expression, ctx) || alwaysThrows(expression, ctx);
}

/** The name a call is made by: `f` of `f()`, `parse` of `JSON.parse()`. */
function calleeName(node: ts.CallExpression | ts.NewExpression): ts.Node {
  const callee = stripParentheses(node.expression);
  return ts.isPropertyAccessExpression(callee) ? callee.name : callee;
}

/** Whether `new X(…)` makes a class of the project whose constructor ends in a `throw`. */
function constructorThrows(created: ts.NewExpression, ctx: FileContext): boolean {
  const callee = stripParentheses(created.expression);
  if (!ts.isIdentifier(callee)) return false;
  const symbol = ctx.types.symbolAt(callee);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || !ts.isClassLike(declared.node)) return false;
  const constructor = declared.node.members.find(ts.isConstructorDeclaration);
  const last = constructor?.body?.statements.at(-1);
  return last !== undefined && ts.isThrowStatement(last);
}

/**
 * The first part of the given code that throws or may, when it is read as handling a value: a call
 * that never returns (`return up(fail(s))`, `[fail(s)]`, `fail(s) ?? "?"`), a `new` of a class whose
 * constructor throws, a getter or setter that runs, or a call of the platform that is not on its
 * closed list of calls that cannot throw (`JSON.parse("")`). A value built from one throws instead
 * of handling the value. Not in nested functions.
 */
function throwingPart(nodes: readonly ts.Node[], ctx: FileContext): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && neverReturns(node, ctx)) found = node;
    else if (ts.isNewExpression(node) && constructorThrows(node, ctx)) found = node;
    else if (ts.isPropertyAccessExpression(node) && ctx.types.readMayRunAccessor(node)) {
      found = node;
    } else if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ctx.types.isPlatformName(calleeName(node)) &&
      !isSafePlatformCall(node, ctx.types)
    ) {
      found = node;
    }
    if (found === undefined) ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return found;
}

/**
 * Whether a statement stops the clause there: a call that never returns, as a statement, kept in
 * a variable (`const r = assertNever(s)`) or awaited, and an awaited `Promise.reject(…)`.
 */
function stopsHere(statement: ts.Statement, ctx: FileContext): boolean {
  if (ts.isExpressionStatement(statement)) {
    const inner = stripParentheses(statement.expression);
    return (
      neverReturns(statement.expression, ctx) ||
      (ts.isAwaitExpression(inner) && isPromiseReject(inner, ctx))
    );
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) =>
        declaration.initializer !== undefined && neverReturns(declaration.initializer, ctx),
    );
  }
  return false;
}

/**
 * How a clause ends: it `throws` (a closed list: a `throw`; a call that never returns: typed
 * `never`, or a function of the project that always throws, also one written and called in place,
 * also kept in a variable; an assertion of a literal `false`; a `Promise.reject(…)` awaited, or
 * returned by a function that returns a promise), it `handles` a value (a closed list: it returns
 * a value, ends in a statement or an `if`, or falls out of the `switch` into code that handles
 * it), or the proof cannot tell (`unknown`). `after` is the code after the `switch`, which a clause
 * that falls out of it runs.
 */
export function endingOf(
  statements: readonly ts.Statement[],
  ctx: FileContext,
  after: readonly ts.Statement[] = [],
): Ending {
  const ending = clauseEnding(statements, ctx, after);
  if (ending.kind !== "handles") return ending;
  // A clause handles a value only when nothing in it throws on the way: a value built from a
  // call that never returns throws instead.
  const throwing = throwingPart(keptStatements(statements), ctx);
  return throwing === undefined
    ? ending
    : {
        kind: "unknown",
        reason: `\`${oneLineText(throwing, ctx.sourceFile)}\` can throw, so the \`default\` may never hand a value back`,
      };
}

type Ending = { kind: "handles" | "throws" | "never" } | { kind: "unknown"; reason: string };

function clauseEnding(
  statements: readonly ts.Statement[],
  ctx: FileContext,
  after: readonly ts.Statement[] = [],
): Ending {
  const kept = keptStatements(statements);
  const last = kept.at(-1);
  // Nothing left, or a `break`: the value goes on after the `switch`.
  if (last === undefined) return after.length === 0 ? { kind: "handles" } : endingOf(after, ctx);
  if (onlyChecksNever(kept, ctx)) return { kind: "never" };
  // A call that never returns ends the clause there: what follows it does not run.
  const stops = kept.findIndex((one) => stopsHere(one, ctx));
  if (stops >= 0 && !returnsValue(kept.slice(0, stops), ctx)) return { kind: "throws" };
  if (
    ts.isReturnStatement(last) &&
    last.expression !== undefined &&
    isPromiseReject(last.expression, ctx) &&
    !returnsValue(kept.slice(0, -1), ctx)
  ) {
    // A rejection is a throw to the code that awaits the promise; elsewhere it is a value.
    const fn = ts.findAncestor(last, ts.isFunctionLike);
    const promised =
      fn !== undefined &&
      ((ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0 ||
        ctx.types.returnsPromiseLike(fn));
    return promised
      ? { kind: "throws" }
      : {
          kind: "unknown",
          reason: `\`${oneLineText(last.expression, ctx.sourceFile)}\` is returned by a function that does not return a promise`,
        };
  }
  if (returnsValue(statements, ctx)) return { kind: "handles" };
  if (ts.isThrowStatement(last)) return { kind: "throws" };
  if (ts.isBlock(last)) return endingOf(last.statements, ctx, after);
  if (ts.isReturnStatement(last) || ts.isExpressionStatement(last)) {
    if (last.expression === undefined) return { kind: "handles" };
    if (neverReturns(last.expression, ctx)) return { kind: "throws" };
    const assertion = assertionCall(last.expression, ctx);
    if (assertion === "false") return { kind: "throws" };
    if (assertion !== undefined) {
      return {
        kind: "unknown",
        reason: `the assertion \`${oneLineText(assertion.expression, ctx.sourceFile)}(…)\` may let the value through`,
      };
    }
    // A statement that goes on falls out of the `switch` into the code after it.
    if (ts.isExpressionStatement(last) && after.length > 0) return endingOf(after, ctx);
    return { kind: "handles" };
  }
  if (ts.isVariableStatement(last) || ts.isIfStatement(last)) {
    return after.length > 0 && !ts.isIfStatement(last) ? endingOf(after, ctx) : { kind: "handles" };
  }
  return {
    kind: "unknown",
    reason: `it ends in \`${oneLineText(last, ctx.sourceFile).split(" ")[0] ?? ""}\`, which stateward does not read`,
  };
}

/** The statements after a `switch` in the block that holds it: what a clause that falls out runs. */
function statementsAfter(node: ts.SwitchStatement): readonly ts.Statement[] {
  const holder = node.parent;
  if (
    !ts.isBlock(holder) &&
    !ts.isSourceFile(holder) &&
    !ts.isCaseClause(holder) &&
    !ts.isDefaultClause(holder)
  ) {
    return [];
  }
  const index = holder.statements.indexOf(node);
  return index < 0 ? [] : holder.statements.slice(index + 1);
}

/** `Promise.reject(…)`, `await Promise.reject(…)`: the platform's `Promise`, not a name of the project. */
function isPromiseReject(expression: ts.Expression, ctx: FileContext): boolean {
  let inner = stripParentheses(expression);
  while (ts.isAwaitExpression(inner)) inner = stripParentheses(inner.expression);
  if (ts.isNewExpression(inner)) return rejectsOnly(inner, ctx);
  if (!ts.isCallExpression(inner)) return false;
  const callee = stripParentheses(inner.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "reject" ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "Promise"
  ) {
    return false;
  }
  const symbol = ctx.types.symbolAt(callee.expression);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declared !== undefined && !ctx.types.isOwnFile(declared.file);
}

/**
 * `new Promise((_, reject) => reject(…))`: the platform's `Promise`, whose executor calls its
 * `reject` and never names its `resolve`.
 */
function rejectsOnly(created: ts.NewExpression, ctx: FileContext): boolean {
  const callee = stripParentheses(created.expression);
  if (!ts.isIdentifier(callee) || callee.text !== "Promise") return false;
  const symbol = ctx.types.symbolAt(callee);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || ctx.types.isOwnFile(declared.file)) return false;
  const executor = created.arguments?.[0];
  const fn = executor === undefined ? undefined : stripParentheses(executor);
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  const [resolve, reject] = fn.parameters;
  if (reject === undefined || !ts.isIdentifier(reject.name)) return false;
  const resolveName =
    resolve !== undefined && ts.isIdentifier(resolve.name) ? resolve.name.text : "";
  const rejectName = reject.name.text;
  const namesResolve = anyNode(
    fn.body,
    (child) => ts.isIdentifier(child) && child.text === resolveName,
  );
  const callsReject = anyNode(
    fn.body,
    (child) =>
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === rejectName,
  );
  return callsReject && !namesResolve;
}

/** Whether `test` holds for the node or any node inside it. */
function anyNode(node: ts.Node, test: (child: ts.Node) => boolean): boolean {
  return (
    test(node) || (ts.forEachChild(node, (child) => anyNode(child, test) || undefined) ?? false)
  );
}

/**
 * A call to an assertion function (`function invariant(c: unknown, m: string): asserts c`):
 * "false" when its first argument is the literal `false` (it always throws), else the call.
 */
function assertionCall(
  expression: ts.Expression,
  ctx: FileContext,
): ts.CallExpression | "false" | undefined {
  const inner = stripParentheses(expression);
  if (!ts.isCallExpression(inner)) return undefined;
  const callee = stripParentheses(inner.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declared?.node;
  const fn =
    node !== undefined && ts.isVariableDeclaration(node) && node.initializer !== undefined
      ? stripParentheses(node.initializer)
      : node;
  const type = fn !== undefined && ts.isFunctionLike(fn) ? fn.type : undefined;
  if (type === undefined || !ts.isTypePredicateNode(type) || type.assertsModifier === undefined) {
    return undefined;
  }
  const [first] = inner.arguments;
  return first !== undefined && stripParentheses(first).kind === ts.SyntaxKind.FalseKeyword
    ? "false"
    : inner;
}

/**
 * The `default` of a switch over an open union: one that only throws is a finding; one whose end
 * the proof cannot read is not checked, against the union.
 */
function checkOpenDefault(
  fallback: ts.DefaultClause,
  subject: ts.Expression,
  stated: readonly RelatedNote[],
  ctx: FileContext,
): void {
  const ending = endingOf(fallback.statements, ctx, statementsAfter(fallback.parent.parent));
  if (ending.kind === "throws" || ending.kind === "never") {
    checkOpenThrows(fallback, subject, stated, ctx, ending.kind);
  } else if (ending.kind === "unknown") {
    const alias = openAliasOf(subject, ctx);
    ctx.unknown({
      node: fallback.getFirstToken(ctx.sourceFile) ?? fallback,
      message: `not checked: whether the \`default\` handles a value outside \`${alias?.name.text ?? ctx.types.typeTextOf(subject)}\`: ${ending.reason}`,
      hint: "return or set a fallback value in `default`, or throw there plainly",
      ...(alias === undefined ? {} : { against: alias }),
    });
  }
}

/** A `default` of a switch over an open union that only throws: it does not handle a value outside the union. */
function checkOpenThrows(
  fallback: ts.DefaultClause,
  subject: ts.Expression,
  stated: readonly RelatedNote[],
  ctx: FileContext,
  how: "throws" | "never",
): void {
  const alias = openAliasOf(subject, ctx);
  const union = alias?.name.text ?? ctx.types.typeTextOf(subject);
  ctx.report({
    node: fallback.getFirstToken(ctx.sourceFile) ?? fallback,
    message: fitted((cut) =>
      how === "throws"
        ? `the \`default\` throws on a value outside \`${cut(union)}\``
        : `the \`default\` only checks against \`never\`, so a value outside \`${cut(union)}\` goes through unhandled`,
    ),
    hint: [
      "one of",
      `- handle a value outside \`${union}\` in \`default\`: return or set a fallback value`,
      `- or remove \`OpenUnion\` from \`${union}\`, if its values are all listed`,
    ].join("\n"),
    findingKind: "open-throws",
    against: true,
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
  const inFile = namesInFile(ctx.sourceFile);
  const imports = unspelledEnums(labels, spellings);
  const type = restType({ hidden: labels, spellings, inFile });
  const every = literals.map((literal) => typeCode(literal.label, spellings, inFile));
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
    hint: fixLines({
      values: values ?? labels,
      subject: shown,
      allow,
      many,
      noDefault: true,
      imports,
    }),
    ...(many
      ? { findingKind: "many-missing", severity: "info" as const }
      : { findingKind: "missing", ...(stated.length > 0 ? { against: true as const } : {}) }),
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
  if (literals === "not-finite") {
    // The tag of a union stated open can hold any string: its cases are not a finite list, yet a
    // `switch` over it still needs a `default` for the kinds it does not list.
    if (openObjectOf(subject, ctx) !== undefined) {
      // `ignore` leaves a stated open union alone no more than any other setting.
      const given = clauses.find(ts.isDefaultClause);
      if (given === undefined) checkOpen(node, subject, statedNote(subject, ctx), ctx);
      else checkOpenDefault(given, subject, statedNote(subject, ctx), ctx);
    }
    return;
  }
  const open = isOpenSubject(subject, ctx);
  if (!open && ignoredType(subject, settings.ignore, ctx)) return;
  const stated = open ? statedNote(subject, ctx) : [];
  const fallback = clauses.find(ts.isDefaultClause);
  if (fallback === undefined && open) checkOpen(node, subject, stated, ctx);
  if (fallback !== undefined && open) checkOpenDefault(fallback, subject, stated, ctx);
  // A member a package adds in a later version is not a state the app designed; an open union is
  // stated by the project, wherever its members come from.
  if (!open && settings.projectTypesOnly && ctx.types.isLibraryType(subject)) return;
  const covered = coveredLabels(clauses, literals, ctx);
  for (const { expression, member } of valueCases(clauses, literals, ctx)) {
    const shown = oneLineText(expression, ctx.sourceFile);
    const code = memberCode(member, ctx.sourceFile);
    ctx.report({
      node: expression,
      message: fitted(
        (cut) =>
          `\`case ${cut(shown)}\` matches \`${cut(member)}\` by its value, which TypeScript does not check`,
      ),
      hint:
        code === undefined
          ? `write \`case ${member}:\`, with \`${enumParts(member)?.owner ?? member}\` imported as a value, so TypeScript checks the \`switch\` too`
          : `write \`case ${code}:\`, so TypeScript checks the \`switch\` too`,
      findingKind: "enum-value",
      severity: "info",
      ...(code === undefined
        ? {}
        : {
            fixes: [
              {
                title: `Write ${code}`,
                edits: [
                  {
                    location: {
                      file: ctx.file,
                      start: expression.getStart(ctx.sourceFile),
                      end: expression.getEnd(),
                    },
                    newText: code,
                  },
                ],
              },
            ],
          }),
    });
  }
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
  const inFile = namesInFile(ctx.sourceFile);
  const imports = unspelledEnums(labels, spellings);
  const type = restType({ hidden: labels, spellings, inFile });
  const every = literals.map((literal) => typeCode(literal.label, spellings, inFile));
  const allCodes = every.every((code) => code !== undefined) ? every : undefined;
  const where = fallback.getFirstToken(ctx.sourceFile) ?? fallback;
  const kind = many
    ? { findingKind: "many-hidden", severity: "info" as const }
    : { findingKind: "hidden", ...(stated.length > 0 ? { against: true as const } : {}) };
  const allow = allowanceOf(subject, shown, type);
  const hint = fixLines({
    values: values ?? labels,
    subject: shown,
    allow,
    many,
    noDefault: false,
    imports,
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
    message: takenHeadline(labels, shown, settings.maxHidden),
    hint,
    ...kind,
    related: stated,
    ...(fixes.length === 0 ? {} : { fixes }),
  });
}
