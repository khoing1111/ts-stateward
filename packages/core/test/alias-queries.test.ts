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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-alias-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function show(alias: { name: string; file: string; promised: boolean } | undefined): string {
  return alias === undefined
    ? "none"
    : `${alias.name}@${path.basename(alias.file)}${alias.promised ? " (promise)" : ""}`;
}

/** For every variable named `probe*`: its alias; for every function named `probe*`: its return alias. */
const aliasProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.name.text.startsWith("probe") && node.initializer !== undefined) {
          const alias = ctx.types.awaitedAliasOf(node.initializer);
          ctx.report({ node, hint: "probe hint", message: `${node.name.text}: ${show(alias)}` });
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text.startsWith("probe") === true) {
        const alias = ctx.types.returnAliasOf(node);
        ctx.report({ node, hint: "probe hint", message: `${node.name.text}: ${show(alias)}` });
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
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      files: Object.keys(sources),
    }),
  );
  for (const [name, text] of Object.entries(sources)) writeFileSync(path.join(dir, name), text);
  return checkFixture(dir, [plugin({ probe: aliasProbe })]).findings.map((f) => f.message);
}

const LIB = [
  "export type Res<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };",
  "export declare function good<T>(value: T): Res<T, never>;",
  "export declare function bad<E>(error: E): Res<never, E>;",
  "export declare function load(): Res<number, Error>;",
  "export declare function loadLater(): Promise<Res<number, Error>>;",
].join("\n");

describe("TypeQueries.awaitedAliasOf and returnAliasOf", () => {
  it("names the alias and its file for a value, a promise of it, and an inferred return", () => {
    expect(
      project({
        "lib.ts": LIB,
        "a.ts": [
          "import { good, bad, load, loadLater } from './lib.js';",
          "import type { Res } from './lib.js';",
          "export const probeSync = load();",
          "export const probeLater = loadLater();",
          "export const probeGood = good(1);",
          "export const probeBad = bad('no');",
          "export async function probeAsync(): Promise<Res<string, Error>> { return good(''); }",
          "export function probeInferred(flag: boolean) { return flag ? good(1) : bad('no'); }",
          "export async function probeInferredAsync(flag: boolean) { return flag ? good(1) : bad('no'); }",
          "type Mine = Res<boolean, Error>;",
          "export function probeRenamed(): Mine { return good(true); }",
        ].join("\n"),
      }),
    ).toEqual([
      "probeSync: Res@lib.ts",
      "probeLater: Res@lib.ts (promise)",
      "probeGood: Res@lib.ts",
      "probeBad: Res@lib.ts",
      "probeAsync: Res@lib.ts (promise)",
      "probeInferred: Res@lib.ts",
      "probeInferredAsync: Res@lib.ts (promise)",
      "probeRenamed: Res@lib.ts",
    ]);
  });

  it("is none for other types, for a Result mixed with another type, and for a lookalike elsewhere", () => {
    expect(
      project({
        "lib.ts": LIB,
        "a.ts": [
          "import { load } from './lib.js';",
          "type Own<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error };",
          "declare function own(): Own<number>;",
          "declare const maybe: ReturnType<typeof load> | undefined;",
          "export const probeNumber = 1;",
          "export const probeVoid = void 0;",
          "export const probeMaybe = maybe;",
          "export const probeAny = JSON.parse('1') as unknown;",
          "export const probeOwn = own();",
          "export function probeNothing(): void {}",
          "export const probeObject = { ok: true } as const;",
        ].join("\n"),
      }),
    ).toEqual([
      "probeNumber: none",
      "probeVoid: none",
      "probeMaybe: none",
      "probeAny: none",
      "probeOwn: Own@a.ts",
      "probeNothing: none",
      "probeObject: none",
    ]);
  });
});
