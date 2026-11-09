import ts from "typescript";
import type { EditorAction, TextEdit } from "./types.js";

/** The 1.1.0 marker property, `__guarantee?: "owned"`, and the prefix of the 1.2 one. */
const LEGACY = "__guarantee";
const PREFIX = "__guarantee:";

/** The names a 1.1.0 marker property states, or undefined when it is not one (required, not literals). */
function legacyNames(member: ts.TypeElement): readonly string[] | undefined {
  if (!ts.isPropertySignature(member) || member.questionToken === undefined) return undefined;
  const { name, type } = member;
  if (!(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== LEGACY)
    return undefined;
  if (type === undefined) return undefined;
  const parts = ts.isUnionTypeNode(type) ? type.types : [type];
  const names: string[] = [];
  for (const part of parts) {
    if (!ts.isLiteralTypeNode(part) || !ts.isStringLiteral(part.literal)) return undefined;
    names.push(part.literal.text);
  }
  return names;
}

/** Every 1.1.0 marker property in the file. */
function legacyMarkers(sourceFile: ts.SourceFile): ts.PropertySignature[] {
  const found: ts.PropertySignature[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && legacyNames(node) !== undefined) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * "Rewrite the guarantee markers to the 1.2 form" on a 1.1.0 marker (`readonly __guarantee?:
 * "owned"`): every one in the file becomes one optional property per trait
 * (`readonly "__guarantee:owned"?: true`), so traits combine by intersection. Undefined when the
 * range touches none. Both forms are read; this only lets a type state two traits.
 */
export function legacyMarkerRewrite(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): EditorAction | undefined {
  const markers = legacyMarkers(sourceFile);
  const touched = markers.some(
    (marker) => marker.getStart(sourceFile) <= end && start <= marker.getEnd(),
  );
  if (!touched) return undefined;
  const edits = markers.flatMap((marker): TextEdit[] => {
    const names = legacyNames(marker) ?? [];
    const readonly =
      marker.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ===
      true;
    const type = marker.type;
    if (type === undefined) return [];
    const from = marker.name.getStart(sourceFile);
    const text = names
      .map((name, index) => `${index > 0 && readonly ? "readonly " : ""}"${PREFIX}${name}"?: true`)
      .join("; ");
    return [{ location: { file: sourceFile.fileName, start: from, end: type.end }, newText: text }];
  });
  const count = markers.length;
  return {
    title:
      count === 1
        ? "Rewrite the guarantee marker to the 1.2 form (one property per trait)"
        : `Rewrite the ${String(count)} guarantee markers to the 1.2 form (one property per trait)`,
    edits,
  };
}
