import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileRule } from "../src/internal.js";
import { checkFixture } from "../src/testing.js";
import { meta, plugin } from "./probe-plugin.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-unique-symbol-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For every type alias named `Probe*` and every variable named `probe*`: the key files, by base name. */
const keyProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      const named = ts.isTypeAliasDeclaration(node)
        ? { name: node.name.text, target: node.type }
        : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          ? { name: node.name.text, target: node.name }
          : undefined;
      if (named !== undefined && /^[Pp]robe/.test(named.name)) {
        const files = ctx.types.uniqueSymbolKeyFiles(named.target).map((f) => path.basename(f));
        ctx.report({
          node,
          hint: "probe hint",
          message: `${named.name}: [${files.join(",")}]`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function project(sources: Record<string, string>): string[] {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        types: [],
      },
      files: Object.keys(sources),
    }),
  );
  for (const [name, text] of Object.entries(sources)) writeFileSync(path.join(dir, name), text);
  return checkFixture(dir, [plugin({ probe: keyProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.uniqueSymbolKeyFiles", () => {
  it("names the file that declares the unique symbol a type is keyed by", () => {
    expect(
      project({
        "lib.ts": [
          "declare const tag: unique symbol;",
          "export type Tagged<T> = T & { readonly [tag]: true };",
        ].join("\n"),
        "a.ts": [
          "import type { Tagged } from './lib.js';",
          "export type ProbeNumber = Tagged<number>;",
          "export type ProbeBoth = Tagged<number> & { readonly [other]: 1 };",
          "declare const other: unique symbol;",
          "export declare const probeValue: Tagged<string>;",
        ].join("\n"),
      }),
    ).toEqual(["ProbeNumber: [lib.ts]", "ProbeBoth: [a.ts,lib.ts]", "probeValue: [lib.ts]"]);
  });

  it("follows a symbol that is re-exported", () => {
    expect(
      project({
        "sym.ts": "export const tag: unique symbol = Symbol();",
        "lib.ts": "export { tag } from './sym.js';",
        "a.ts": [
          "import { tag } from './lib.js';",
          "export type ProbeViaReexport = { readonly [tag]: true };",
        ].join("\n"),
      }),
    ).toEqual(["ProbeViaReexport: [sym.ts]"]);
  });

  it("is empty for plain types, string keys, and keys that are not unique symbols", () => {
    expect(
      project({
        "a.ts": [
          "declare const loose: symbol;",
          "export type ProbePlain = { a: string };",
          "export type ProbePrimitive = number;",
          "export type ProbeString = { ['name']: string };",
          "export declare const probeAny: { [key: string]: string };",
          "export type ProbeLoose = { [k in 'a']: 1 };",
          "export const probeUnused = loose;",
        ].join("\n"),
      }),
    ).toEqual([
      "ProbePlain: []",
      "ProbePrimitive: []",
      "ProbeString: []",
      "probeAny: []",
      "ProbeLoose: []",
      "probeUnused: []",
    ]);
  });
});
