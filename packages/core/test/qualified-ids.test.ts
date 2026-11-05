import ts from "typescript";
import { describe, expect, it } from "vitest";
import { declarationPath } from "../src/backend/qualified-ids.js";

/** The path of every named declaration of `text`, by name, in file order. */
function paths(text: string): string[] {
  const sourceFile = ts.createSourceFile("a.tsx", text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node)
    ) {
      found.push(declarationPath(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const SOURCE = `
export function useCart() {
  const onAdd = () => 1;
  return { onAdd };
}
class Api { getUser() { const user = 1; return user; } }
function twice() {
  { const handler = 1; }
  { const handler = 2; }
}
export default () => null;
`;

describe("qualified ids", () => {
  it("names a declaration by its chain of declaration names", () => {
    expect(paths(SOURCE)).toEqual([
      "useCart",
      "useCart.onAdd",
      "useCart.onAdd.$ArrowFunction",
      "Api.getUser",
      "Api.getUser.user",
      "twice",
      "twice.handler",
      "twice.handler$2",
      "default.$ArrowFunction",
    ]);
  });

  it("keeps every id when an edit above a declaration does not rename or move it", () => {
    const edited = SOURCE.replace(
      "export function useCart() {",
      "import { x } from './x';\nconst banner = `a long line that moves every offset`;\nexport function useCart() {\n  const extra = 2;",
    );
    const before = paths(SOURCE);
    const after = paths(edited).filter((id) => id !== "banner" && id !== "useCart.extra");
    expect(after).toEqual(before);
  });

  it("names the module itself with an empty path", () => {
    const sourceFile = ts.createSourceFile("a.ts", "export {};", ts.ScriptTarget.Latest, true);
    expect(declarationPath(sourceFile)).toBe("");
  });
});
