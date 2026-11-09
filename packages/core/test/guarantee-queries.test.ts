import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileRule } from "../src/internal.js";
import { checkFixture } from "../src/testing.js";
import { meta, plugin } from "./probe-plugin.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-guarantees-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * For every variable named `probe*`: its guarantees read from the name (a node) and from its
 * symbol; and for every type alias named `Probe*`: those of its type node.
 */
const guaranteeProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.name.text.startsWith("probe")) {
          const symbol = ctx.types.symbolAt(node.name);
          const bySymbol = symbol === undefined ? ["?"] : ctx.types.guaranteesOf(symbol);
          ctx.report({
            node,
            hint: "probe hint",
            message: `${node.name.text}: [${ctx.types.guaranteesOf(node.name).join(",")}] [${bySymbol.join(",")}]`,
          });
        }
      } else if (ts.isTypeAliasDeclaration(node) && node.name.text.startsWith("Probe")) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.name.text}: [${ctx.types.guaranteesOf(node.type).join(",")}]`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function write(name: string, text: string): void {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function project(sources: Record<string, string>, packages: Record<string, string> = {}): string[] {
  write(
    "tsconfig.json",
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
  for (const [name, text] of Object.entries({ ...sources, ...packages })) write(name, text);
  return checkFixture(dir, [plugin({ probe: guaranteeProbe })]).findings.map((f) => f.message);
}

const GUARANTEES = [
  "export type Box<T> = { readonly value: T };",
  'export type Required<T> = Box<T> & { readonly __guarantee?: "required-context" };',
  "export type Guarantee<N extends string> = { readonly __guarantee?: N };",
  "export function required<T>(value: T): Required<T> { return { value }; }",
].join("\n");

describe("TypeQueries.guaranteesOf", () => {
  it("reads the guarantee through an alias, a generic helper and a re-export", () => {
    expect(
      project({
        "guarantees.ts": GUARANTEES,
        "index.ts": "export { required, type Required } from './guarantees.js';",
        "a.ts": [
          "import { required, type Required } from './index.js';",
          "import type { Box, Guarantee } from './guarantees.js';",
          "type Local<T> = Required<T>;",
          "export const probeCall = required(1);",
          "export const probeAnnotated: Local<string> = required('a');",
          "export const probeHelper: Box<number> & Guarantee<'owned' | 'stable'> = { value: 1 };",
          "export const probeOptional: Required<number> | undefined = undefined as Required<number> | undefined;",
          "export const probePlain: Box<number> = { value: 1 };",
          "export type ProbeAlias = Local<boolean>;",
        ].join("\n"),
      }),
    ).toEqual([
      "probeCall: [required-context] [required-context]",
      "probeAnnotated: [required-context] [required-context]",
      "probeHelper: [owned,stable] [owned,stable]",
      "probeOptional: [required-context] [required-context]",
      "probePlain: [] []",
      "ProbeAlias: [required-context]",
    ]);
  });

  it("reads one property per trait (the 1.2 form), and traits combine by intersection, nested or flat", () => {
    expect(
      project({
        "guarantees.ts": [
          'export type Owned<T> = T & { readonly "__guarantee:owned"?: true };',
          'export type Opaque<T, N extends string> = T & { readonly "__guarantee:opaque"?: N };',
          'export type OpenUnion<T> = T & { readonly "__guarantee:open-union"?: true };',
          'export type Legacy<T> = T & { readonly __guarantee?: "required-context" };',
        ].join("\n"),
        "a.ts": [
          "import type { Legacy, OpenUnion, Opaque, Owned } from './guarantees.js';",
          "export const probeOwned = { a: 1 } as Owned<{ a: number }>;",
          "export const probeBoth = 'x' as Owned<Opaque<string, 'Id'>>;",
          "export const probeMixedForms = { a: 1 } as Owned<Legacy<{ a: number }>>;",
          "export const probeOpen = 'paid' as OpenUnion<'paid' | 'shipped'>;",
          "export const probeRequired = { a: 1 } as { a: number; readonly '__guarantee:owned': true };",
          "type Store = { items: string[] };",
          "type Single<T = unknown> = T & { readonly '__guarantee:single-provider'?: true };",
          "type Owns<T = unknown> = T & { readonly '__guarantee:owned'?: true };",
          "export const probeFlat = { items: [] } as Store & Owns & Single;",
          "export const probeNested = { items: [] } as Owns<Single<Store>>;",
          "export type ProbeOpenStatus = OpenUnion<'paid' | 'shipped'>;",
        ].join("\n"),
      }),
    ).toEqual([
      "probeOwned: [owned] [owned]",
      "probeBoth: [opaque,owned] [opaque,owned]",
      "probeMixedForms: [owned,required-context] [owned,required-context]",
      "probeOpen: [open-union] [open-union]",
      "probeRequired: [] []",
      "probeFlat: [owned,single-provider] [owned,single-provider]",
      "probeNested: [owned,single-provider] [owned,single-provider]",
      "ProbeOpenStatus: [open-union]",
    ]);
  });

  it("is empty for a brand (a required tag) and a tag that is not a string literal", () => {
    expect(
      project({
        "a.ts": [
          "export const probeBrand = 1 as number & { readonly __guarantee: 'required-context' };",
          "export const probeWide = { value: 1 } as { value: number; readonly __guarantee?: string };",
          "export const probeMixed = { value: 1 } as { value: number; __guarantee?: 'x' } | { value: number };",
        ].join("\n"),
      }),
    ).toEqual(["probeBrand: [] []", "probeWide: [] []", "probeMixed: [] []"]);
  });

  it("reads a guarantee declared in another package of a monorepo", () => {
    expect(
      project(
        {
          "a.ts": [
            "import { ThemeContext } from '@acme/ui';",
            "export const probeShared = ThemeContext;",
          ].join("\n"),
        },
        {
          "node_modules/@acme/ui/package.json": JSON.stringify({
            name: "@acme/ui",
            types: "./index.d.ts",
          }),
          "node_modules/@acme/ui/index.d.ts": [
            "type Context<T> = { Provider: (props: { value: T }) => null };",
            'export type RequiredContext<T> = Context<T> & { readonly __guarantee?: "required-context" };',
            "export declare const ThemeContext: RequiredContext<{ dark: boolean }>;",
          ].join("\n"),
        },
      ),
    ).toEqual(["probeShared: [required-context] [required-context]"]);
  });
});

/** Reports, on the first statement, whether any file of the program declares the `opaque` trait. */
const traitProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const [first] = ctx.sourceFile.statements;
    if (first === undefined || !ctx.file.endsWith("a.ts")) return;
    ctx.report({
      node: first,
      hint: "probe hint",
      message: `declares opaque: ${String(ctx.types.declaresTrait("opaque"))}`,
    });
  },
};

function declaresOpaque(sources: Record<string, string>): string[] {
  write(
    "tsconfig.json",
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
  for (const [name, text] of Object.entries(sources)) write(name, text);
  return checkFixture(dir, [plugin({ probe: traitProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.declaresTrait", () => {
  it("counts the marker only as a property of a type, not inside a string or a comment", () => {
    expect(
      declaresOpaque({
        "quoted.ts": [
          '/** The trait `Opaque<T, Name>` states: `"__guarantee:opaque"?: Name`. */',
          'export const TEXT = "export type Opaque<T, N extends string> = T & { readonly \\"__guarantee:opaque\\"?: N };";',
        ].join("\n"),
        "a.ts": "export const a = 1;",
      }),
    ).toEqual(["declares opaque: false"]);
    expect(
      declaresOpaque({
        "guarantees.ts":
          'export type Opaque<T, N extends string> = T & { readonly "__guarantee:opaque"?: N };',
        "a.ts": "export const a = 1;",
      }),
    ).toEqual(["declares opaque: true"]);
  });
});
