import ts from "@stateward/core/typescript";
import { matchesName, type FileContext } from "@stateward/core";
import { oneLineText } from "./text.js";

/** The code the unions rules share: the cases of a union, as code reads and writes them. */

/** The code a rule shares with the others that ask for a `never` proof. */

export function stripParentheses(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression)
    ? stripParentheses(expression.expression)
    : expression;
}

/**
 * The statements that always run when the branch does: its own, or those of a block that is its
 * only statement. A statement inside an `if`, a loop or a `try` may not run, so it is not here.
 */
export function alwaysRunning(statements: readonly ts.Statement[]): readonly ts.Statement[] {
  const [only, ...rest] = statements;
  if (only !== undefined && rest.length === 0 && ts.isBlock(only)) return only.statements;
  return statements;
}

/** The indentation of the line that holds `position`. */
export function leadingSpace(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
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
