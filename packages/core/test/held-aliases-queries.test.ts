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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-held-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For each `return` expression and variable initializer: the aliases its type and its context hold. */
const heldProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      const expression =
        ts.isReturnStatement(node) || ts.isVariableDeclaration(node)
          ? ts.isReturnStatement(node)
            ? node.expression
            : node.initializer
          : undefined;
      if (expression !== undefined) {
        const names = (contextual: boolean): string =>
          ctx.types
            .heldAliasesOf(expression, contextual)
            .map((alias) => alias.name)
            .join(",");
        ctx.report({
          node,
          hint: "probe hint",
          message: `${expression.getText(ctx.sourceFile)}: own [${names(false)}] expected [${names(true)}]`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function project(text: string): string[] {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", noEmit: true, types: [] },
      files: ["a.ts"],
    }),
  );
  writeFileSync(path.join(dir, "a.ts"), text);
  return checkFixture(dir, [plugin({ probe: heldProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.heldAliasesOf", () => {
  it("lists the aliases inside an array, a map, an object and a promise, for the type and its context", () => {
    expect(
      project(
        [
          'type Id = string & { readonly __brand: "Id" };',
          "declare const raw: string[];",
          "declare const ids: Id[];",
          "declare const table: Map<string, string>;",
          "declare const entry: { id: string };",
          "export function a(): Id[] { return raw; }",
          "export function b(): Id[] { return ids; }",
          "export function c(): Map<string, Id> { return table; }",
          "export function d(): { id: Id } { return entry; }",
          "export async function e(): Promise<Id[]> { return raw; }",
          "export function f(): Id { return raw[0] as Id; }",
        ].join("\n"),
      ),
    ).toEqual([
      "raw: own [] expected [Id]",
      "ids: own [Id] expected [Id]",
      "table: own [] expected [Id]",
      "entry: own [] expected [Id]",
      "raw: own [] expected [Id]",
      "raw[0] as Id: own [] expected []",
    ]);
  });
});
