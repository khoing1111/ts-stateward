import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTypeQueries } from "../src/backend/typescript6.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-symbol-at-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Every identifier of `a.ts` named `name`, in file order, with the queries of its program. */
function setup(sources: Record<string, string>, name: string) {
  for (const [file, text] of Object.entries(sources)) writeFileSync(path.join(dir, file), text);
  const files = Object.keys(sources).map((file) => path.join(dir, file).split(path.sep).join("/"));
  const program = ts.createProgram({
    rootNames: files,
    options: { strict: true, noEmit: true, module: ts.ModuleKind.ESNext, types: [] },
  });
  const types = createTypeQueries(
    program,
    new Set(files),
    dir,
    () => undefined,
    () => false,
    () => [],
  );
  const sourceFile = program.getSourceFile(files[0] ?? "");
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  if (sourceFile !== undefined) visit(sourceFile);
  return { types, found };
}

describe("symbolAt, answered once per node", () => {
  it("gives the same answer when asked again, and the same ref for every use of a symbol", () => {
    const { types, found } = setup(
      {
        "a.ts": `import { load } from "./b";\nload();\nload();\n`,
        "b.ts": `export function load(): void {}\n`,
      },
      "load",
    );
    const [imported, first, second] = found;
    if (imported === undefined || first === undefined || second === undefined) {
      throw new Error("expected three uses of load");
    }
    const ref = types.symbolAt(first);
    expect(ref).toEqual({ id: "b.ts#load", name: "load" });
    expect(types.symbolAt(first)).toBe(ref);
    // An alias (the import) resolves to the declaration: one ref for the symbol.
    expect(types.symbolAt(second)).toBe(ref);
    expect(types.symbolAt(imported)).toBe(ref);
    expect(ref === undefined ? undefined : types.declarationOf(ref)?.file).toBe(
      path.join(dir, "b.ts").split(path.sep).join("/"),
    );
  });

  it("remembers a node that has no symbol", () => {
    const { types, found } = setup({ "a.ts": `const n = missing;\n` }, "missing");
    const [use] = found;
    if (use === undefined) throw new Error("expected a use of missing");
    expect(types.symbolAt(use)).toBeUndefined();
    expect(types.symbolAt(use)).toBeUndefined();
  });
});
