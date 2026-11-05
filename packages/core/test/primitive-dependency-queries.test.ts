import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileRule } from "../src/internal.js";
import { check, parseConfig } from "../src/internal.js";
import { checkFixture } from "../src/testing.js";
import { meta, plugin } from "./probe-plugin.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-primitive-queries-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

class ProbeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeConfigError";
  }
}

/** For every variable named `probe*`: whether `isPrimitive` says its value is compared by value. */
const primitiveProbe: FileRule = {
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
          message: `${node.name.text}: ${String(ctx.types.isPrimitive(node.name))}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

/** Reports, once per file, what `dependenciesOf` says about it. */
const dependencyProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    ctx.report({
      node: ctx.sourceFile,
      hint: "probe hint",
      message: `deps: ${ctx.types.dependenciesOf(ctx.file).join(",")}`,
    });
  },
};

function writeProject(source: string): void {
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
}

describe("TypeQueries.isPrimitive", () => {
  it("is true for values compared by value, false for objects, functions, symbols, any and unknown", () => {
    writeProject(
      [
        "enum Color { Red, Blue }",
        "declare const probeString: string;",
        'declare const probeLiterals: "a" | 1 | true | null | undefined;',
        "declare const probeEnum: Color;",
        "declare const probeBig: bigint;",
        "declare const probeObject: { a: string };",
        "declare const probeFunction: () => void;",
        "declare const probeArray: string[];",
        "declare const probeMixed: string | { a: string };",
        "declare const probeSymbol: symbol;",
        "declare const probeAny: any;",
        "declare const probeUnknown: unknown;",
        "function f<T extends string>(probeParameter: T) { return probeParameter; }",
        "export { f };",
      ].join("\n"),
    );
    expect(
      checkFixture(dir, [plugin({ probe: primitiveProbe })]).findings.map((f) => f.message),
    ).toEqual([
      "probeString: true",
      "probeLiterals: true",
      "probeEnum: true",
      "probeBig: true",
      "probeObject: false",
      "probeFunction: false",
      "probeArray: false",
      "probeMixed: false",
      "probeSymbol: false",
      "probeAny: false",
      "probeUnknown: false",
      "probeParameter: true",
    ]);
  });
});

describe("TypeQueries.dependenciesOf", () => {
  const run = (): string[] => {
    const parsed = parseConfig(
      { preset: "recommended", plugins: [plugin({ probe: dependencyProbe })] },
      dir,
    );
    if (!parsed.ok) throw new ProbeConfigError(parsed.errors.join("\n"));
    return check({ config: parsed.value, cwd: dir }).findings.map((f) => f.message);
  };

  it("lists every kind of dependency of the nearest package.json, sorted, and nothing without one", () => {
    writeProject("export const a = 1;");
    expect(run()).toEqual(["deps: "]);
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.0.0" },
        devDependencies: { "babel-plugin-react-compiler": "^1.0.0", react: "^19.0.0" },
        peerDependencies: { "react-dom": "^19.0.0" },
        optionalDependencies: { fsevents: "^2.0.0" },
      }),
    );
    expect(run()).toEqual(["deps: babel-plugin-react-compiler,fsevents,react,react-dom"]);
  });

  it("is empty for a package.json that is not JSON", () => {
    writeProject("export const a = 1;");
    writeFileSync(path.join(dir, "package.json"), "{");
    expect(run()).toEqual(["deps: "]);
  });
});
