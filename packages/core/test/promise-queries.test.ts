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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-promise-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * For every variable named `probe*`: whether its value is promise-like and has a defined
 * `signal`; for every function named `probe*`: whether it returns a promise-like value.
 */
const promiseProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.name.text.startsWith("probe") && node.initializer !== undefined) {
          const promise = ctx.types.isPromiseLike(node.initializer) ? "promise" : "value";
          const signal = ctx.types.hasDefinedProperty(node.initializer, "signal") ? " signal" : "";
          const callable = ctx.types.isCallable(node.initializer) ? " callable" : "";
          const never = ctx.types.neverFieldsOf(node.initializer).join(",");
          const expects = ctx.types.expectsPromiseReturn(node.initializer)
            ? " expects-promise"
            : "";
          ctx.report({
            node,
            hint: "probe hint",
            message: `${node.name.text}: ${promise}${signal}${callable}${never === "" ? "" : ` never:${never}`}${expects}`,
          });
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith("probe") === true) {
        const promise = ctx.types.returnsPromiseLike(node) ? "promise" : "value";
        ctx.report({ node, hint: "probe hint", message: `${node.name.text}: returns ${promise}` });
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
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      files: ["a.ts"],
    }),
  );
  writeFileSync(path.join(dir, "a.ts"), text);
  return checkFixture(dir, [plugin({ probe: promiseProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.isPromiseLike, returnsPromiseLike, hasDefinedProperty, isCallable and expectsPromiseReturn", () => {
  it("tells promises, thenables and maybe-promises from other values", () => {
    expect(
      project(
        [
          "declare const maybe: Promise<number> | undefined;",
          "declare const thenable: { then(onfulfilled: (value: number) => void): void };",
          "declare const anything: any;",
          "export const probePromise = Promise.resolve(1);",
          "export const probeMaybe = maybe;",
          "export const probeThenable = thenable;",
          "export const probeNumber = 1;",
          "export const probeAny = anything;",
          "export function probeDeclared(): Promise<void> { return Promise.resolve(); }",
          "export function probeInferred() { return Promise.resolve(1); }",
          "export async function probeAsync() {}",
          "export function probeSync(): number { return 1; }",
        ].join("\n"),
      ),
    ).toEqual([
      "probePromise: promise",
      "probeMaybe: promise",
      "probeThenable: promise",
      "probeNumber: value",
      "probeAny: value",
      "probeDeclared: returns promise",
      "probeInferred: returns promise",
      "probeAsync: returns promise",
      "probeSync: returns value",
    ]);
  });

  it("finds a property only when it is required and cannot be undefined or null", () => {
    expect(
      project(
        [
          "type Signal = { readonly aborted: boolean };",
          "declare const required: { signal: Signal };",
          "declare const optional: { signal?: Signal };",
          "declare const nullable: { signal: Signal | null };",
          "declare const either: { signal: Signal } | { other: 1 };",
          "export const probeRequired = required;",
          "export const probeOptional = optional;",
          "export const probeNullable = nullable;",
          "export const probeEither = either;",
          "export const probeLiteral = { signal: required.signal };",
        ].join("\n"),
      ),
    ).toEqual([
      "probeRequired: value signal",
      "probeOptional: value",
      "probeNullable: value",
      "probeEither: value",
      "probeLiteral: value signal",
    ]);
  });

  it("names the properties typed never in a member of the type", () => {
    expect(
      project(
        [
          "type Load = { status: 'loading' } | { status: 'failed'; error: never } | (() => void);",
          "declare function set(next: Load): void;",
          "declare const plain: { error: Error };",
          "export const probeWide = { status: 'loading' } satisfies Load;",
          "export const probePlain = plain;",
          "export const probeNever = { status: 'failed' } as { status: string; error: never };",
        ].join("\n"),
      ),
    ).toEqual(["probeWide: value", "probePlain: value", "probeNever: value never:error"]);
  });

  it("tells a function from a string, a list, null and any", () => {
    expect(
      project(
        [
          "declare const anything: any;",
          "declare const maybe: ((s: string) => string) | undefined;",
          "declare const either: ((s: string) => string) | string;",
          "export const probeArrow = (s: string) => s;",
          "export const probeMaybe = maybe;",
          "export const probeEither = either;",
          "export const probeText = 'x';",
          "export const probeList = ['a'];",
          "export const probeNull = null;",
          "export const probeAny = anything;",
        ].join("\n"),
      ),
    ).toEqual([
      "probeArrow: value callable",
      "probeMaybe: value callable",
      "probeEither: value",
      "probeText: value",
      "probeList: value",
      "probeNull: value",
      "probeAny: value",
    ]);
  });

  it("tells a function expected to return a promise, through an alias, a method or a union", () => {
    expect(
      project(
        [
          "type Handler = (text: string) => Promise<string>;",
          "type Props = { onSubmit: Handler } | { fallback: true };",
          "type Method = { onSave(): Promise<void> };",
          "const props: Props = { onSubmit: async (text) => text };",
          "const method: Method = { onSave: async () => {} };",
          "export const probeAlias: Handler = async (text) => text;",
          "export const probeMaybe: Handler | undefined = async (text) => text;",
          "export const probeSync: (text: string) => string = (text) => text;",
          "export const probeMixed: Handler | ((text: string) => void) = async () => {};",
          "export const probeVoid: (text: string) => void | Promise<void> = async () => {};",
          "export const probeUnion = props;",
          "export const probeMethod = method;",
        ].join("\n"),
      ),
    ).toEqual([
      "probeAlias: value callable expects-promise",
      "probeMaybe: value callable expects-promise",
      "probeSync: value callable",
      "probeMixed: value callable",
      "probeVoid: value callable",
      "probeUnion: value",
      "probeMethod: value",
    ]);
  });
});
