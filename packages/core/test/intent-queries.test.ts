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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-intent-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For every variable named `probe*`: its index signature, and whether it settles with an error. */
const intentProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("probe")
      ) {
        const index = ctx.types.indexSignatureOf(node.name);
        const shown =
          index === undefined
            ? "no index"
            : `${index.keyKind} -> ${index.valueText}${index.valueCanBeUndefined ? " (maybe missing)" : ""}`;
        const settles = ctx.types.settlesWithError(node.name) ? "; settles with error" : "";
        ctx.report({ node, hint: "probe hint", message: `${node.name.text}: ${shown}${settles}` });
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
  return checkFixture(dir, [plugin({ probe: intentProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.indexSignatureOf", () => {
  it("tells an open dictionary (a lookup may miss) from a loosely typed table", () => {
    expect(
      project(
        [
          "type Dict = Partial<Record<string, string>>;",
          "export const probeLoose: Record<string, string> = { a: 'A' };",
          "export const probePartial: Partial<Record<string, string>> = { a: 'A' };",
          "export const probeAlias: Dict = { a: 'A' };",
          "export const probeSignature: { [key: string]: number | undefined } = { a: 1 };",
          "export const probeNumbers: Record<number, string> = { 1: 'one' };",
          "export const probeFixed = { a: 'A' };",
        ].join("\n"),
      ),
    ).toEqual([
      "probeLoose: string -> string",
      "probePartial: string -> string | undefined (maybe missing)",
      "probeAlias: string -> string | undefined (maybe missing)",
      "probeSignature: string -> number | undefined (maybe missing)",
      "probeNumbers: number -> string",
      "probeFixed: no index",
    ]);
  });
});

describe("TypeQueries.settlesWithError", () => {
  it("finds a promise with an unwrap method that resolves to data or an error", () => {
    expect(
      project(
        [
          "type Outcome = { data: number; error?: undefined } | { data?: undefined; error: unknown };",
          "type Trigger = Promise<Outcome> & { unwrap(): Promise<number> };",
          "declare const trigger: Trigger;",
          "declare const plain: Promise<Outcome>;",
          "declare const noError: Promise<{ data: number }> & { unwrap(): Promise<number> };",
          "declare const notCallable: Promise<Outcome> & { unwrap: number };",
          "declare const anything: any;",
          "export const probeTrigger = trigger;",
          "export const probePlain = plain;",
          "export const probeNoError = noError;",
          "export const probeNotCallable = notCallable;",
          "export const probeAny = anything;",
        ].join("\n"),
      ),
    ).toEqual([
      "probeTrigger: no index; settles with error",
      "probePlain: no index",
      "probeNoError: no index",
      "probeNotCallable: no index",
      "probeAny: no index",
    ]);
  });
});

/** For every call in the file: the callee's text and its JSDoc tags. */
const tagsProbe: FileRule = {
  kind: "file",
  meta: { ...meta, needsJsDoc: true },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const tags = ctx.types.calleeTags(node);
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.expression.getText(ctx.sourceFile)}: ${tags.join(", ") || "none"}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

describe("TypeQueries.calleeTags", () => {
  it("reads the tags on the function, the property or alias it is reached through, a destructured prop included", () => {
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", noEmit: true, types: [] },
        files: ["a.ts"],
      }),
    );
    writeFileSync(
      path.join(dir, "a.ts"),
      [
        "/** @neverRejects */",
        "type Safe = (q: string) => Promise<void>;",
        "type Props = {",
        "  /** @neverRejects */",
        "  search?: (q: string) => Promise<void>;",
        "  safe: Safe;",
        "  plain: () => Promise<void>;",
        "};",
        "/** @neverRejects @internal */",
        "async function load(): Promise<void> {}",
        "/** @neverRejects */",
        "const save = async (): Promise<void> => {};",
        "export function run(props: Props, { search }: Props): void {",
        '  void props.search?.("a");',
        '  void search?.("b");',
        '  void props.safe("c");',
        "  void props.plain();",
        "  void load();",
        "  void save();",
        "}",
      ].join("\n"),
    );
    expect(
      checkFixture(dir, [plugin({ probe: tagsProbe })]).findings.map((f) => f.message),
    ).toEqual([
      "props.search: neverRejects",
      "search: neverRejects",
      "props.safe: neverRejects",
      "props.plain: none",
      "load: internal, neverRejects",
      "save: neverRejects",
    ]);
  });
});
