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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-guard-queries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For every variable or parameter named `probe*`: its property keys and whether it can be undefined. */
const valueProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("probe")
      ) {
        const keys = ctx.types.propertyKeysOf(node.name);
        const shown =
          typeof keys === "string"
            ? keys
            : `required=${keys.required.join(",")} optional=${keys.optional.join(",")} index=${String(keys.indexSignature)}`;
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.name.text}: ${shown} undefined=${String(ctx.types.canBeUndefined(node.name))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** For every property access `probe*.name`: whether `isDiscriminant` says yes. */
const discriminantProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.startsWith("probe")
      ) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.getText()}: ${String(ctx.types.isDiscriminant(node.expression, node.name.text))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** For every variable or parameter named `probe*`: the type as `typeTextOf` prints it. */
const typeTextProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.name.text}: ${ctx.types.typeTextOf(node.name)}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** For every call to a function named `probe*`: `parameterIsNever` for each argument. */
const neverProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.startsWith("probe")
      ) {
        const answers = node.arguments.map((_, index) =>
          String(ctx.types.parameterIsNever(node, index)),
        );
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.expression.text}: ${answers.join(",")}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** For every call to a function named `probe*`: `parameterIsReadonly` for each argument. */
const readonlyProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.startsWith("probe")
      ) {
        const answers = node.arguments.map((_, index) =>
          String(ctx.types.parameterIsReadonly(node, index)),
        );
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.expression.text}: ${answers.join(",")}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function project(sources: Record<string, string>, probe: FileRule, strict = true): string[] {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        types: [],
      },
      files: Object.keys(sources).filter((name) => !name.endsWith(".d.ts") || name === "lib.d.ts"),
    }),
  );
  for (const [name, text] of Object.entries(sources)) writeFileSync(path.join(dir, name), text);
  return checkFixture(dir, [plugin({ probe })]).findings.map((f) => f.message);
}

describe("TypeQueries.propertyKeysOf", () => {
  it("splits required and optional properties, sorted, and reports index signatures", () => {
    expect(
      project(
        {
          "a.ts": [
            "type Entry = { b: string; a: number; c?: boolean };",
            "export declare const probeEntry: Entry;",
            "export declare const probeRecord: Record<'x' | 'y', string>;",
            "export declare const probeOpen: Record<string, string>;",
            "export declare const probeMixed: { a: string; [key: string]: string };",
            "export declare const probePartial: Partial<Record<'p' | 'q', string>>;",
            "export declare const probeBoth: { a: string } & { b: string };",
          ].join("\n"),
        },
        valueProbe,
      ),
    ).toEqual([
      "probeEntry: required=a,b optional=c index=false undefined=false",
      "probeRecord: required=x,y optional= index=false undefined=false",
      "probeOpen: required= optional= index=true undefined=false",
      "probeMixed: required=a optional= index=true undefined=false",
      "probePartial: required= optional=p,q index=false undefined=false",
      "probeBoth: required=a,b optional= index=false undefined=false",
    ]);
  });

  it("says not-object for arrays and array-likes, but not for a record keyed by numbers", () => {
    expect(
      project(
        {
          "a.ts": [
            "interface Files { readonly length: number; [index: number]: string }",
            "export declare const probeArray: string[];",
            "export declare const probeMatch: RegExpMatchArray;",
            "export declare const probeFiles: Files;",
            "export declare const probeByNumber: Record<number, string>;",
            "export declare const probeLengthy: { length: number; [key: string]: number };",
          ].join("\n"),
        },
        valueProbe,
      ),
    ).toEqual([
      "probeArray: not-object undefined=false",
      "probeMatch: not-object undefined=false",
      "probeFiles: not-object undefined=false",
      "probeByNumber: required= optional= index=true undefined=false",
      "probeLengthy: required=length optional= index=true undefined=false",
    ]);
  });

  it("widens a type parameter to its constraint", () => {
    expect(
      project(
        { "a.ts": "export function f<T extends { a: 1 }>(probeArg: T): T { return probeArg; }\n" },
        valueProbe,
      ),
    ).toEqual(["probeArg: required=a optional= index=false undefined=false"]);
  });

  it("says not-object for primitives, unions, arrays and tuples", () => {
    expect(
      project(
        {
          "a.ts": [
            "export declare const probeText: string;",
            "export declare const probeEither: { a: 1 } | { b: 2 };",
            "export declare const probeList: string[];",
            "export declare const probeTuple: [string, number];",
            "export declare const probeReadonly: readonly string[];",
            "export function f<T>(probeAny: T): T { return probeAny; }",
          ].join("\n"),
        },
        valueProbe,
      ),
    ).toEqual([
      "probeText: not-object undefined=false",
      "probeEither: not-object undefined=false",
      "probeList: not-object undefined=false",
      "probeTuple: not-object undefined=false",
      "probeReadonly: not-object undefined=false",
      "probeAny: not-object undefined=true",
    ]);
  });
});

/** For every variable or parameter named `probe*`: whether its type can be `null`. */
const nullProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("probe")
      ) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.name.text}: null=${String(ctx.types.canBeNull(node.name))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

describe("TypeQueries.canBeNull", () => {
  it("is true for null members, any and unknown, false otherwise", () => {
    const lines = project(
      {
        "a.ts": [
          "export declare const probeYes: string | null;",
          "export declare const probeNo: string | undefined;",
          "export declare const probeAny: any;",
          "export declare const probeUnknown: unknown;",
          "export function f<T extends string | null>(probeParam: T): T { return probeParam; }",
          "export function g<T extends string>(probeOther: T): T { return probeOther; }",
        ].join("\n"),
      },
      nullProbe,
    );
    expect(lines).toEqual([
      "probeYes: null=true",
      "probeNo: null=false",
      "probeAny: null=true",
      "probeUnknown: null=true",
      "probeParam: null=true",
      "probeOther: null=false",
    ]);
  });
});

describe("TypeQueries.canBeUndefined", () => {
  it("is true for undefined members, any, unknown and void, false otherwise", () => {
    const lines = project(
      {
        "a.ts": [
          "export declare const probeNo: string | null;",
          "export declare const probeYes: string | undefined;",
          "export declare const probeOnly: undefined;",
          "export declare const probeAny: any;",
          "export declare const probeUnknown: unknown;",
          "export declare const probeVoid: void;",
          "export function f<T extends string | undefined>(probeParam: T): T { return probeParam; }",
          "export function g<T extends string>(probeOther: T): T { return probeOther; }",
        ].join("\n"),
      },
      valueProbe,
    );
    expect(lines.map((line) => line.replace(/ required.*index=\w+/, ""))).toEqual([
      "probeNo: not-object undefined=false",
      "probeYes: not-object undefined=true",
      "probeOnly: not-object undefined=true",
      "probeAny: not-object undefined=true",
      "probeUnknown: not-object undefined=true",
      "probeVoid: not-object undefined=true",
      "probeParam: not-object undefined=true",
      "probeOther: not-object undefined=false",
    ]);
  });

  it("sees the undefined an optional property adds, and not one an index signature leaves out", () => {
    const lines = project(
      {
        "a.ts": [
          "declare const holder: { a?: string; b: string };",
          "declare const open: Record<string, string>;",
          "export const probeOptional = holder.a;",
          "export const probeRequired = holder.b;",
          "export const probeIndexed = open['x'];",
        ].join("\n"),
      },
      valueProbe,
    );
    expect(lines).toEqual([
      "probeOptional: not-object undefined=true",
      "probeRequired: not-object undefined=false",
      "probeIndexed: not-object undefined=false",
    ]);
  });
});

describe("TypeQueries.isDiscriminant", () => {
  it("is true when every member has a literal or a union of literals for the property, not all the same", () => {
    const lines = project(
      {
        "a.ts": [
          "enum E { A, B }",
          "type S = { kind: 'a'; x: 1 } | { kind: 'b' };",
          "export function f(",
          "  probeS: S,",
          "  probeEnum: { t: E.A } | { t: E.B },",
          "  probeBool: { ok: true } | { ok: false },",
          "  probeNumber: { n: 1 } | { n: 2 },",
          "  probeShared: { mode: 'x' | 'y'; p: 1 } | { mode: 'x' | 'y'; q: 1 },",
          "  probeWeak: { kind: 'a' } | { kind: string },",
          "  probeMissing: { kind: 'a' } | { other: 1 },",
          "  probeOptional: { kind: 'a' } | { kind?: 'b' },",
          "  probeUndefined: { kind: 'a' | 'b' } | undefined,",
          "  probeNullable: S | undefined,",
          "  probeNull: { kind: 'a' } | null,",
          "  probeOnlyNull: null,",
          "  probeObject: { kind: 'a' | 'b' },",
          "  probeSingle: { kind: 'a' },",
          "  probeLiterals: 'a' | 'b',",
          "  probeMixed: 'a' | { kind: 'b' },",
          "): void {",
          "  void [probeS.kind, probeEnum.t, probeBool.ok, probeNumber.n, probeShared.mode];",
          "  void [probeWeak.kind, probeMissing.kind, probeOptional.kind, probeUndefined.kind];",
          "  void [probeNullable?.kind, probeNull?.kind, probeOnlyNull?.kind];",
          "  void [probeObject.kind, probeSingle.kind, probeLiterals.length, probeMixed.length];",
          "}",
          "export function g<T extends S>(probeParam: T): T { void probeParam.kind; return probeParam; }",
          "export function h<T extends { kind: 'a' | 'b' }>(probePlain: T): T { void probePlain.kind; return probePlain; }",
        ].join("\n"),
      },
      discriminantProbe,
    );
    expect(lines).toEqual([
      "probeS.kind: true",
      "probeEnum.t: true",
      "probeBool.ok: true",
      "probeNumber.n: true",
      "probeShared.mode: false",
      "probeWeak.kind: false",
      "probeMissing.kind: false",
      "probeOptional.kind: false",
      "probeUndefined.kind: false",
      "probeNullable?.kind: true",
      "probeNull?.kind: true",
      "probeOnlyNull?.kind: false",
      "probeObject.kind: false",
      "probeSingle.kind: false",
      "probeLiterals.length: false",
      "probeMixed.length: false",
      "probeParam.kind: true",
      "probePlain.kind: false",
    ]);
  });

  it("is true for members that are intersections or whose tag is a union, as TypeScript narrows them", () => {
    const lines = project(
      {
        "a.ts": [
          "export function f(",
          "  probeIntersection: ({ id: 1 } & { kind: 'a' }) | ({ id: 1 } & { kind: 'b' }),",
          "  probeUnionTag: { kind: 'a' | 'b' } | { kind: 'c'; y: 1 },",
          "  probeWider: { mode: 'x' | 'y'; p: 1 } | { mode: 'x' | 'y' | 'z' },",
          "): void {",
          "  void [probeIntersection.kind, probeUnionTag.kind, probeWider.mode];",
          "}",
        ].join("\n"),
      },
      discriminantProbe,
    );
    expect(lines).toEqual([
      "probeIntersection.kind: true",
      "probeUnionTag.kind: true",
      "probeWider.mode: true",
    ]);
  });
});

describe("TypeQueries.propertyKeysOf with generic keys", () => {
  it("says generic for a mapped type over a type parameter, alone or in an intersection", () => {
    expect(
      project(
        {
          "a.ts": [
            "type U = 'a' | 'b';",
            "export function f<K extends U>(",
            "  probeRecord: Record<K, string>,",
            "  probeMapped: { [P in K]: number },",
            "  probePartial: Partial<Record<K, string>>,",
            "  probeBoth: Record<K, string> & { extra: string },",
            "): void { void [probeRecord, probeMapped, probePartial, probeBoth]; }",
            "export declare const probeConcrete: Record<U, string>;",
            "export declare const probeNever: { [P in U]: number };",
          ].join("\n"),
        },
        valueProbe,
      ),
    ).toEqual([
      "probeRecord: generic undefined=false",
      "probeMapped: generic undefined=false",
      "probePartial: generic undefined=false",
      "probeBoth: generic undefined=false",
      "probeConcrete: required=a,b optional= index=false undefined=false",
      "probeNever: required=a,b optional= index=false undefined=false",
    ]);
  });
});

describe("TypeQueries.typeTextOf", () => {
  it("prints the type of an expression on one line", () => {
    expect(
      project(
        {
          "a.ts": [
            "export declare const labels: Record<string, string>;",
            "export declare const shape: { a: string;",
            "  b: number };",
            "export declare const choice: 'x' | 'y';",
          ].join("\n"),
        },
        typeTextProbe,
      ),
    ).toEqual([
      "labels: Record<string, string>",
      "shape: { a: string; b: number; }",
      'choice: "x" | "y"',
    ]);
  });
});

describe("TypeQueries.parameterIsNever", () => {
  it("decides from the declared parameter type of the called function", () => {
    expect(
      project(
        {
          "a.ts": [
            "export function probeOwn(value: never, context?: string): never { throw new Error(String(value) + String(context)); }",
            "export function probeText(value: string): void { void value; }",
            "export function probeAlias(value: Gone): void { void value; }",
            "type Gone = never;",
            "export function probeRest(...values: never[]): void { void values; }",
            "export function probeGeneric<T extends never>(value: T): void { void value; }",
            "export const probeArrow = (value: never): void => { void value; };",
            "export function probeThis(this: object, value: never): void { void value; }",
            "declare const x: never;",
            "probeOwn(x, 'ctx');",
            "probeText('a');",
            "probeAlias(x);",
            "probeRest(x, x);",
            "probeGeneric(x);",
            "probeArrow(x);",
            "probeThis.call({}, x);",
          ].join("\n"),
        },
        neverProbe,
      ),
    ).toEqual([
      "probeOwn: true,false",
      "probeText: false",
      "probeAlias: false",
      "probeRest: false,false",
      "probeGeneric: false",
      "probeArrow: true",
    ]);
  });

  it("reads an imported function and a .d.ts declaration, whatever the local name", () => {
    expect(
      project(
        {
          "lib.d.ts":
            "export declare function assertNever(value: never, context?: string): never;\n",
          "own.ts":
            "export function probeCheck(value: never): never { throw new Error(String(value)); }\n",
          "a.ts": [
            "import { assertNever as probeLib } from './lib.js';",
            "import { probeCheck } from './own.js';",
            "declare const x: never;",
            "probeLib(x, 'ctx');",
            "probeCheck(x);",
          ].join("\n"),
        },
        neverProbe,
      ),
    ).toEqual(["probeLib: true,false", "probeCheck: true"]);
  });

  it("is false for a call that resolves to no declaration", () => {
    expect(
      project({ "a.ts": "declare const probeMissing: any;\nprobeMissing(1);\n" }, neverProbe),
    ).toEqual(["probeMissing: false"]);
  });
});

describe("TypeQueries.parameterIsReadonly", () => {
  it("is true for a type through which the callee cannot change a key", () => {
    expect(
      project(
        {
          "a.ts": [
            "type Dict = Readonly<Record<string, string>>;",
            "export function probeReadonly(v: Readonly<Record<string, string>>): void { void v; }",
            "export function probeAlias(v: Dict): void { void v; }",
            "export function probeIndex(v: { readonly [k: string]: number }): void { void v; }",
            "export function probeMap(v: ReadonlyMap<string, string>): void { void v; }",
            "export function probeSet(v: ReadonlySet<string>): void { void v; }",
            "export function probeList(v: readonly string[]): void { void v; }",
            "export function probeOptional(v?: Dict | null): void { void v; }",
            "export function probeGeneric<T extends Dict>(v: T): void { void v; }",
            "export function probeBoth(v: Dict & { readonly [k: number]: string }): void { void v; }",
            "declare const dict: Dict;",
            "declare const map: ReadonlyMap<string, string>;",
            "declare const set: ReadonlySet<string>;",
            "declare const list: readonly string[];",
            "probeReadonly(dict);",
            "probeAlias(dict);",
            "probeIndex({});",
            "probeMap(map);",
            "probeSet(set);",
            "probeList(list);",
            "probeOptional(dict);",
            "probeGeneric(dict);",
            "probeBoth(dict);",
          ].join("\n"),
        },
        readonlyProbe,
      ),
    ).toEqual([
      "probeReadonly: true",
      "probeAlias: true",
      "probeIndex: true",
      "probeMap: true",
      "probeSet: true",
      "probeList: true",
      "probeOptional: true",
      "probeGeneric: true",
      "probeBoth: true",
    ]);
  });

  it("is false for a mutable type, a loose type, a rest parameter and a missing declaration", () => {
    expect(
      project(
        {
          "a.ts": [
            "export function probeRecord(v: Record<string, string>): void { void v; }",
            "export function probeIndex(v: { [k: string]: string }): void { void v; }",
            "export function probeMap(v: Map<string, string>): void { void v; }",
            "export function probeMixed(v: Readonly<Record<string, string>> | Record<string, string>): void { void v; }",
            "export function probeProperty(v: { readonly [k: string]: string; a: string }): void { void v; }",
            "export function probeObject(v: object): void { void v; }",
            "export function probeUnknown(v: unknown): void { void v; }",
            "export function probeRest(...v: Readonly<Record<string, string>>[]): void { void v; }",
            "export function probeGeneric<T>(v: T): void { void v; }",
            "export function probeOnly(v: undefined): void { void v; }",
            "declare const probeMissing: any;",
            "declare const dict: Readonly<Record<string, string>>;",
            "declare const record: Record<string, string>;",
            "probeRecord(record);",
            "probeIndex(record);",
            "probeMap(new Map());",
            "probeMixed(dict);",
            "probeProperty({ a: '' });",
            "probeObject(dict);",
            "probeUnknown(dict);",
            "probeRest(dict, dict);",
            "probeGeneric(dict);",
            "probeOnly(undefined);",
            "probeMissing(dict);",
          ].join("\n"),
        },
        readonlyProbe,
      ),
    ).toEqual([
      "probeRecord: false",
      "probeIndex: false",
      "probeMap: false",
      "probeMixed: false",
      "probeProperty: false",
      "probeObject: false",
      "probeUnknown: false",
      "probeRest: false,false",
      "probeGeneric: false",
      "probeOnly: false",
      "probeMissing: false",
    ]);
  });

  it("is false for an argument after a spread and for an extra argument", () => {
    expect(
      project(
        {
          "a.ts": [
            "export function probeTwo(a: string, b: Readonly<Record<string, string>>): void { void [a, b]; }",
            "declare const dict: Readonly<Record<string, string>>;",
            "declare const args: [string, Readonly<Record<string, string>>];",
            "probeTwo('a', dict);",
            "probeTwo(...args);",
          ].join("\n"),
        },
        readonlyProbe,
      ),
    ).toEqual(["probeTwo: false,true", "probeTwo: false"]);
  });
});

/** For every switch: whether `isLibraryType` says its subject's type is declared outside the project. */
const libraryProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isSwitchStatement(node)) {
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.expression.getText()}: ${String(ctx.types.isLibraryType(node.expression))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

describe("TypeQueries.isLibraryType", () => {
  it("is true for an alias, an enum or a property declared in a package, false for the project's own", () => {
    mkdirSync(path.join(dir, "node_modules", "lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "node_modules", "lib", "package.json"),
      JSON.stringify({ name: "lib", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(
      path.join(dir, "node_modules", "lib", "index.d.ts"),
      [
        "export type LibMode = 'a' | 'b';",
        "export declare enum LibColor { Red, Blue }",
        "export type LibEvent = { type: 'down' } | { type: 'up' };",
        "export declare const libFlag: { on: 'yes' | 'no' };",
      ].join("\n"),
    );
    const lines = project(
      {
        "a.ts": [
          "import { LibColor, libFlag, type LibEvent, type LibMode } from 'lib';",
          "type Own = 'x' | 'y';",
          "export function f(m: LibMode, c: LibColor, e: LibEvent, o: Own, i: 'p' | 'q'): void {",
          "  switch (m) {}",
          "  switch (c) {}",
          "  switch (e.type) {}",
          "  switch (libFlag.on) {}",
          "  switch (o) {}",
          "  switch (i) {}",
          "}",
        ].join("\n"),
      },
      libraryProbe,
    );
    expect(lines).toEqual([
      "m: true",
      "c: true",
      "e.type: true",
      "libFlag.on: true",
      "o: false",
      "i: false",
    ]);
  });
});
