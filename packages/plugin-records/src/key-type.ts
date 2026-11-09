import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";
import { stripParentheses } from "./syntax.js";

/**
 * A key's type as a separately declared union (`type Status = "idle" | "done"`): its name, its
 * file, and the alias's name in its declaration, for a note that shows where it is declared.
 */
export type DeclaredKeyType = { name: string; file: string; node: ts.Identifier };

/** The type annotation of what `key` reads: a parameter, variable or property, or a call's return type. */
function annotationOf(key: ts.Expression, ctx: FileContext): ts.TypeNode | undefined {
  const inner = stripParentheses(key);
  const named = ts.isCallExpression(inner) ? inner.expression : inner;
  const symbol = ctx.types.symbolAt(named);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declared?.node;
  if (node === undefined) return undefined;
  if (
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node)
  ) {
    return node.type;
  }
  return undefined;
}

/**
 * The declared union or enum `key` is typed with, when the code names it: the key's annotation
 * (or its function's return type) refers to a type alias or an enum. Undefined for an inline
 * union, an inferred type, or a type the annotation does not name. The name is as the reading
 * file writes it.
 */
export function declaredKeyType(key: ts.Expression, ctx: FileContext): DeclaredKeyType | undefined {
  const annotation = annotationOf(key, ctx);
  if (annotation === undefined || !ts.isTypeReferenceNode(annotation)) return undefined;
  if (annotation.typeArguments !== undefined) return undefined;
  const symbol = ctx.types.symbolAt(annotation.typeName);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declared?.node;
  if (declared === undefined || node === undefined) return undefined;
  if (!ts.isTypeAliasDeclaration(node) && !ts.isEnumDeclaration(node)) return undefined;
  return {
    name: annotation.typeName.getText(annotation.getSourceFile()),
    file: declared.file,
    node: node.name,
  };
}
