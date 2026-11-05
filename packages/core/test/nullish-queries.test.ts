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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-nullish-queries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For every `x as T`: whether `isAssignableWithoutNullish` says the cast only drops null/undefined. */
const castProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node)) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.getText(ctx.sourceFile)}: ${String(ctx.types.isAssignableWithoutNullish(node.expression, node.type))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function answers(source: string): string[] {
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
      files: ["a.ts"],
    }),
  );
  writeFileSync(path.join(dir, "a.ts"), source);
  return checkFixture(dir, [plugin({ probe: castProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.isAssignableWithoutNullish", () => {
  it("is true when a cast only removes null or undefined", () => {
    expect(
      answers(
        [
          "type Id = string & { readonly tag: true };",
          "declare const maybe: Id | undefined;",
          "declare const nullable: Id | null | undefined;",
          "declare const both: Id | string | undefined;",
          "export const a = maybe as Id;",
          "export const b = nullable as Id;",
          "export const c = maybe as Id | null;",
        ].join("\n"),
      ),
    ).toEqual(["maybe as Id: true", "nullable as Id: true", "maybe as Id | null: true"]);
  });

  it("is false when the cast builds something the source was not", () => {
    expect(
      answers(
        [
          "type Id = string & { readonly tag: true };",
          "declare const plain: string | undefined;",
          "declare const unknownValue: unknown;",
          "declare const anyValue: any;",
          "declare const many: Id | string | undefined;",
          "declare const nothing: undefined;",
          "export const a = plain as Id;",
          "export const b = unknownValue as Id;",
          "export const c = anyValue as Id;",
          "export const d = many as Id;",
          "export const e = nothing as Id;",
        ].join("\n"),
      ),
    ).toEqual([
      "plain as Id: false",
      "unknownValue as Id: false",
      "anyValue as Id: false",
      "many as Id: false",
      "nothing as Id: false",
    ]);
  });
});
