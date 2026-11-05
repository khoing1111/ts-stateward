import type ts from "@stateward/core/typescript";
import { matchesName, type TypeQueries } from "@stateward/core";

/**
 * How a value says it failed, read from its type (the project's own `Result`, no helper library): a union with `ok: true | false`, one with `success: true | false` (zod's
 * `safeParse`), or a type with `isOk()` and `isErr()` (neverthrow). `named` is a type the
 * `resultTypes` option names, whatever its shape.
 */
export type ResultShape = "ok" | "success" | "isErr" | "named";

/**
 * Whether a property tells the members of a union apart by `true` and `false`. An object with
 * `ok: boolean` (a fetch `Response`) is not a union, so it is not a Result.
 */
function isBooleanTag(node: ts.Node, property: string, types: TypeQueries): boolean {
  const found = types.awaitedTagsOf(node, property);
  if (found === "missing" || found.members < 2 || typeof found.tags === "string") return false;
  return found.tags.map((tag) => tag.label).join(",") === "false,true";
}

/** Whether every member of a union (two or more) has the property: `isOk` on neverthrow's `Ok | Err`. */
function hasOnEveryMember(node: ts.Node, property: string, types: TypeQueries): boolean {
  const found = types.awaitedTagsOf(node, property);
  return found !== "missing" && found.members >= 2;
}

/** The name a type is printed with, after the `Promise<…>` around it: `Result` in `Promise<Result<A, B>>`. */
function printedName(node: ts.Node, types: TypeQueries): string | undefined {
  let text = types.typeTextOf(node).trim();
  while (/^(?:Promise|PromiseLike)</.test(text)) text = text.slice(text.indexOf("<") + 1);
  return /^[A-Za-z_$][\w$.]*/.exec(text)?.[0];
}

/**
 * The shape of a Result an expression gives (once awaited), or undefined when it is not one.
 * `names`: the `resultTypes` option (names or globs).
 */
export function resultShapeOf(
  node: ts.Node,
  types: TypeQueries,
  names: readonly string[],
): ResultShape | undefined {
  // A primitive (most calls written as a statement give `void`) has no property to tell its
  // members apart: one question instead of four.
  const primitive = types.isPrimitive(node);
  if (!primitive) {
    if (isBooleanTag(node, "ok", types)) return "ok";
    if (isBooleanTag(node, "success", types)) return "success";
    if (hasOnEveryMember(node, "isOk", types) && hasOnEveryMember(node, "isErr", types)) {
      return "isErr";
    }
  }
  if (names.length === 0) return undefined;
  const alias = types.awaitedAliasOf(node)?.name ?? printedName(node, types);
  return alias !== undefined && matchesName(alias, names) ? "named" : undefined;
}

/** Cuts `text` to `max` characters, ending in `…`, for a headline or an example line. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A hint's example: indented 4 spaces, one line per entry. */
export function example(lines: readonly string[]): string {
  return lines.map((line) => `    ${line}`).join("\n");
}
