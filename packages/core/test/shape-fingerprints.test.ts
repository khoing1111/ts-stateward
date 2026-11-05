import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeFingerprints, shapeText } from "../src/backend/fingerprints.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "stateward-shapes-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.Preserve,
  noEmit: true,
  types: [],
};

/** The fingerprint of each file of a project made of `files`, by name. */
function printsOf(files: Readonly<Record<string, string>>): (name: string) => string | undefined {
  const names: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    names.push(file.replaceAll("\\", "/"));
  }
  writeFileSync(path.join(root, "package.json"), '{ "type": "module" }');
  const program = ts.createProgram({ rootNames: names, options: OPTIONS });
  program.getTypeChecker();
  const own = new Set(names);
  const prints = computeFingerprints(
    program,
    own,
    () => undefined,
    () => false,
    () => [],
  );
  const key = (name: string): string => path.join(root, name).replaceAll("\\", "/");
  return (name) => prints.get(key(name));
}

const APP = 'import { make, label } from "./lib.js";\nexport const made = make(label);\n';

/**
 * The importer's fingerprint across an edit of `lib.ts`: whether it stays (what the importer can
 * learn through types is the same). The edited file's own fingerprint always changes.
 */
function importerKeeps(before: string, after: string): boolean {
  const one = printsOf({ "lib.ts": before, "app.ts": APP });
  const two = printsOf({ "lib.ts": after, "app.ts": APP });
  expect(two("lib.ts")).not.toBe(one("lib.ts"));
  return two("app.ts") === one("app.ts");
}

const LIB = [
  "/** Makes a thing. @throws {RangeError} when empty */",
  "export function make(name: string): { name: string } {",
  "  // say why",
  '  if (name === "") throw new RangeError("empty");',
  "  return { name: helper(name) };",
  "}",
  "function helper(name: string) {",
  '  return name + "!";',
  "}",
  'export const label: string = "a";',
  "",
].join("\n");

describe("a file's shape: what its importers can learn about it", () => {
  it("leaves out comments and layout", () => {
    expect(importerKeeps(LIB, `// a comment\n${LIB.replace("  return", "\n\n    return")}`)).toBe(
      true,
    );
    expect(importerKeeps(LIB, LIB.replace("// say why", "/* another reason */"))).toBe(true);
  });

  it("leaves out the body of a function with a declared return type", () => {
    expect(
      importerKeeps(LIB, LIB.replace('throw new RangeError("empty")', "return { name }")),
    ).toBe(true);
  });

  it("leaves out the initializer of a declared const, and a helper only a left-out body uses", () => {
    expect(importerKeeps(LIB, LIB.replace('label: string = "a"', 'label: string = "b"'))).toBe(
      true,
    );
    expect(importerKeeps(LIB, LIB.replace('name + "!"', 'name + "?"'))).toBe(true);
  });

  it("keeps an export's type", () => {
    expect(
      importerKeeps(LIB, LIB.replace("{ name: string }", "{ name: string; id?: number }")),
    ).toBe(false);
    expect(importerKeeps(LIB, LIB.replace("label: string", "label: number"))).toBe(false);
  });

  it("keeps the body of a function whose return type is inferred from it", () => {
    const inferred =
      'export function make(name: string) {\n  return { name };\n}\nexport const label = "a";\n';
    expect(importerKeeps(inferred, inferred.replace("{ name }", "{ name, id: 1 }"))).toBe(false);
    expect(importerKeeps(inferred, inferred.replace('"a"', '"b"'))).toBe(false);
  });

  it("keeps a helper that an export's type names", () => {
    const named =
      'type Name = string;\nexport function make(name: Name): Name {\n  return name;\n}\nexport const label = "a";\n';
    expect(importerKeeps(named, named.replace("type Name = string", "type Name = number"))).toBe(
      false,
    );
  });

  it("keeps the JSDoc of what it keeps: TypeQueries.calleeTags reads its tags", () => {
    // JSDoc is parsed only where the backend asks for it: as the language server parses it.
    const source = (text: string): ts.SourceFile =>
      ts.createSourceFile("/x/lib.ts", text, {
        languageVersion: ts.ScriptTarget.ES2022,
        jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
      });
    const before = shapeText(source(LIB));
    expect(before).toContain("@throws {RangeError}");
    expect(shapeText(source(LIB.replace("RangeError} when", "TypeError} when")))).not.toBe(before);
    expect(shapeText(source(LIB.replace("// say why", "// no reason")))).toBe(before);
  });

  it("keeps whether a declared parameter has an initializer, not what it is", () => {
    const withDefault =
      'export function make(name: string = "x"): string {\n  return name;\n}\nexport const label = "a";\n';
    expect(importerKeeps(withDefault, withDefault.replace('= "x"', '= "y"'))).toBe(true);
    expect(importerKeeps(withDefault, withDefault.replace(' = "x"', ""))).toBe(false);
  });

  it("keeps where a top-level `X.y = …` starts: the qualified id of `y` counts from the top", () => {
    const expando =
      'export function make(name: string): string {\n  return name;\n}\nmake.label = "a";\nexport const label = "a";\n';
    expect(importerKeeps(expando, `// moved\n${expando}`)).toBe(false);
  });

  it("is the whole text of a declaration file or a script", () => {
    const source = (name: string, text: string): ts.SourceFile =>
      ts.createSourceFile(name, text, ts.ScriptTarget.ES2022);
    expect(shapeText(source("/x/a.d.ts", "export declare const a: 1;"))).toBeUndefined();
    expect(shapeText(source("/x/a.ts", "const a = 1;"))).toBeUndefined();
    expect(shapeText(source("/x/a.js", "export const a = 1;"))).toBeUndefined();
  });
});
