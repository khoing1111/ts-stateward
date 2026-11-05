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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-tags-of-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For each identifier named `probe*` that is a value reference: its `status` tags. */
const probe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text.startsWith("probe") &&
        !ts.isParameter(node.parent) &&
        !ts.isVariableDeclaration(node.parent)
      ) {
        const tags = ctx.types.tagsOf(node, "status");
        const text = tags === "not-finite" ? "not-finite" : tags.map((tag) => tag.label).join(",");
        ctx.report({ node, hint: "probe hint", message: `${node.text}: ${text}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function tags(source: string): string[] {
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
  return checkFixture(dir, [plugin({ probe })]).findings.map((f) => f.message);
}

describe("TypeQueries.tagsOf", () => {
  it("gives the literals of a property over the members, sorted, and follows narrowing", () => {
    expect(
      tags(
        [
          "type S = { status: 'b'; n: number } | { status: 'a' | 'c' } | { status: 'd' };",
          "export function f(probeState: S): S {",
          "  probeState;",
          "  if (probeState.status !== 'b') return probeState;",
          "  return probeState;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      'probeState: "a","b","c","d"',
      'probeState: "a","b","c","d"',
      'probeState: "a","c","d"',
      'probeState: "b"',
    ]);
  });

  it("ignores null and undefined members, widens a type parameter to its constraint, and gives nothing for never", () => {
    expect(
      tags(
        [
          "type S = { status: 'a' } | { status: 'b' };",
          "export function f<T extends S>(probeGeneric: T, probeMaybe: S | undefined, probeNever: never): void {",
          "  probeGeneric;",
          "  probeMaybe;",
          "  probeNever;",
          "}",
        ].join("\n"),
      ),
    ).toEqual(['probeGeneric: "a","b"', 'probeMaybe: "a","b"', "probeNever: "]);
  });

  it("is not-finite for a member without the property, a wide property or a non-object", () => {
    expect(
      tags(
        [
          "export function f(",
          "  probeMissing: { status: 'a' } | { other: 1 },",
          "  probeWide: { status: string },",
          "  probeText: string,",
          "  probeNothing: undefined,",
          "): void {",
          "  probeMissing;",
          "  probeWide;",
          "  probeText;",
          "  probeNothing;",
          "}",
        ].join("\n"),
      ),
    ).toEqual([
      "probeMissing: not-finite",
      "probeWide: not-finite",
      "probeText: not-finite",
      "probeNothing: not-finite",
    ]);
  });
});
