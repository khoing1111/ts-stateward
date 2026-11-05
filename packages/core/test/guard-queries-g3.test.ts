import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileRule } from "../src/internal.js";
import { packageEntries } from "../src/backend/fingerprints.js";
import { checkFixture } from "../src/testing.js";
import { meta, plugin } from "./probe-plugin.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-g3-queries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(sources: Record<string, string>, probe: FileRule): string[] {
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
  return checkFixture(dir, [plugin({ probe })]).findings.map((f) => f.message);
}

function reporting(
  describe: (node: ts.Node, ctx: Parameters<FileRule["check"]>[0]) => string | undefined,
): FileRule {
  return {
    kind: "file",
    meta,
    check(ctx) {
      const visit = (node: ts.Node): void => {
        const message = describe(node, ctx);
        if (message !== undefined) ctx.report({ node, hint: "probe hint", message });
        ts.forEachChild(node, visit);
      };
      visit(ctx.sourceFile);
    },
  };
}

/** For every parameter or variable named `probe*`: its discriminants. */
const discriminantProbe = reporting((node, ctx) =>
  (ts.isParameter(node) || ts.isVariableDeclaration(node)) &&
  ts.isIdentifier(node.name) &&
  node.name.text.startsWith("probe")
    ? `${node.name.text}: ${ctx.types.discriminantsOf(node.name).join(",")}`
    : undefined,
);

/** For every property access `x.y` that is the left of a `;` expression statement named `read*`. */
const readonlyPathProbe = reporting((node, ctx) =>
  ts.isExpressionStatement(node) && ts.isPropertyAccessExpression(node.expression)
    ? `${node.expression.getText()}: ${String(ctx.types.isReadonlyPath(node.expression))}`
    : undefined,
);

/** For every call to `probe*(…)` or `x.probe*(…)`: `callMayChange` for the receiver and each argument. */
const changeProbe = reporting((node, ctx) => {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  if (!name.startsWith("probe")) return undefined;
  const answers = node.arguments.map((_, i) => String(ctx.types.callMayChange(node, i)));
  return `${name}: receiver=${String(ctx.types.callMayChange(node, "receiver"))} args=${answers.join(",")}`;
});

describe("TypeQueries.discriminantsOf", () => {
  it("lists the properties with a different unit literal in each member, sorted", () => {
    expect(
      project(
        {
          "a.ts": [
            "type A = { kind: 'a'; mode: 1; same: true; name: string };",
            "type B = { kind: 'b'; mode: 2; same: true; name: string };",
            "export declare const probeUnion: A | B;",
            "export declare const probeNullable: A | B | undefined;",
            "export declare const probeOne: A;",
            "export declare const probeWide: { kind: string } | { kind: 'b' };",
            "export declare const probeText: string;",
            "export function f<T extends A | B>(probeGeneric: T): T { return probeGeneric; }",
          ].join("\n"),
        },
        discriminantProbe,
      ),
    ).toEqual([
      "probeUnion: kind,mode",
      "probeNullable: kind,mode",
      "probeOne: ",
      "probeWide: ",
      "probeText: ",
      "probeGeneric: kind,mode",
    ]);
  });
});

describe("TypeQueries.isReadonlyPath", () => {
  it("is true only when every property on the path is readonly, declared or by Readonly<T>", () => {
    expect(
      project(
        {
          "a.ts": [
            "type Inner = { readonly kind: 'a' | 'b'; open: string };",
            "type Outer = { readonly inner: Inner; readonly flat: string; loose: Inner };",
            "declare const o: Outer;",
            "declare const r: Readonly<{ inner: { kind: string } }>;",
            "declare const union: { readonly v: string } | { v: string };",
            "declare const nothing: Outer | undefined;",
            "o.flat;",
            "o.inner.kind;",
            "o.inner.open;",
            "o.loose.kind;",
            "r.inner;",
            "r.inner.kind;",
            "union.v;",
            "nothing?.flat;",
          ].join("\n"),
        },
        readonlyPathProbe,
      ),
    ).toEqual([
      "o.flat: true",
      "o.inner.kind: true",
      "o.inner.open: false",
      "o.loose.kind: false",
      "r.inner: true",
      "r.inner.kind: false",
      "union.v: false",
      "nothing?.flat: true",
    ]);
  });
});

describe("TypeQueries.callMayChange", () => {
  it("is true for a checked callee that takes a writable object, false for readonly views and the unseen", () => {
    expect(
      project(
        {
          "a.ts": [
            "type Doc = { kind: 'a'; n: number };",
            "declare const doc: Doc;",
            "function probeWrite(d: Doc): void { d.n = 1; }",
            "function probeRead(d: Readonly<Doc>): void { void d; }",
            "function probeOpaque(d: unknown, n: number, ...rest: Doc[]): void { void [d, n, rest]; }",
            "function probeGeneric<T extends Doc>(d: T): T { return d; }",
            "function probeNullable(d: Doc | undefined): void { void d; }",
            "class Box { probeSet(d: Doc): void { void d; } }",
            "probeWrite(doc);",
            "probeRead(doc);",
            "probeOpaque(doc, 1, doc);",
            "probeGeneric(doc);",
            "probeNullable(doc);",
            "new Box().probeSet(doc);",
            "const spread = [doc] as const;",
            "probeWrite(...spread);",
            "Object.assign(doc, { n: 2 });",
          ].join("\n"),
        },
        changeProbe,
      ),
    ).toEqual([
      "probeWrite: receiver=true args=true",
      "probeRead: receiver=true args=false",
      "probeOpaque: receiver=true args=false,false,false",
      "probeGeneric: receiver=true args=true",
      "probeNullable: receiver=true args=true",
      "probeSet: receiver=true args=true",
      "probeWrite: receiver=true args=false",
    ]);
  });
});

describe("packageEntries: a file named by the nearest package.json", () => {
  function write(relative: string, text: string): string {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file.replaceAll("\\", "/");
  }
  const isEntry = () => packageEntries(ts.createCompilerHost({}));

  it("reads main, module, types and every string in exports, a build folder as src", () => {
    write(
      "package.json",
      JSON.stringify({
        name: "lib",
        main: "./dist/index.js",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./extra": ["./src/extra.ts"],
          "./*": "./src/*.ts",
        },
      }),
    );
    const entry = isEntry();
    expect(entry(write("src/index.ts", ""))).toBe(true);
    expect(entry(write("src/extra.ts", ""))).toBe(true);
    expect(entry(write("src/model.ts", ""))).toBe(false);
    expect(entry(write("src/nested/index.ts", ""))).toBe(false);
  });

  it("is false without a package.json, and for a file of an installed dependency", () => {
    expect(isEntry()(path.posix.join("/", "stateward-no-package", "index.ts"))).toBe(false);
    write("node_modules/dep/package.json", JSON.stringify({ main: "index.js" }));
    expect(isEntry()(write("node_modules/dep/index.d.ts", ""))).toBe(false);
  });

  it("uses the nearest manifest, named or not, and survives one that is not JSON", () => {
    write("package.json", JSON.stringify({ main: "index.ts" }));
    write("app/package.json", "{");
    expect(isEntry()(write("app/index.ts", ""))).toBe(false);
    expect(isEntry()(write("index.ts", ""))).toBe(true);
  });
});
