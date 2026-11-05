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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-awaited-tags-of-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** For each call of a function named `probe*`: what its `ok` and `isOk` take once awaited. */
const probe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const show = (found: ReturnType<typeof ctx.types.awaitedTagsOf>): string => {
      if (found === "missing") return found;
      const tags =
        typeof found.tags === "string" ? found.tags : found.tags.map((t) => t.label).join(",");
      return `${tags} of ${String(found.members)}`;
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text.startsWith("probe")
      ) {
        const ok = show(ctx.types.awaitedTagsOf(node, "ok"));
        const isOk = show(ctx.types.awaitedTagsOf(node, "isOk"));
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.expression.text}: ok ${ok}; isOk ${isOk}`,
        });
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
        lib: ["ES2022"],
      },
      files: ["a.ts"],
    }),
  );
  writeFileSync(path.join(dir, "a.ts"), source);
  return checkFixture(dir, [plugin({ probe })]).findings.map((f) => f.message);
}

describe("TypeQueries.awaitedTagsOf", () => {
  it("reads a union's tag, also through a promise, and says when a property is missing or not a literal", () => {
    expect(
      tags(`
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
declare class Ok { isOk(): this is Ok; }
declare function probeSync(): Result<number>;
declare function probeAsync(): Promise<Result<number> | undefined>;
declare function probeClass(): Ok;
declare function probeFlag(): { ok: boolean };
declare function probeNumber(): number;
declare function probeAny(): any;
probeSync();
probeAsync();
probeClass();
probeFlag();
probeNumber();
probeAny();
`),
    ).toEqual([
      "probeSync: ok false,true of 2; isOk missing",
      "probeAsync: ok false,true of 2; isOk missing",
      "probeClass: ok missing; isOk not-finite of 1",
      "probeFlag: ok false,true of 1; isOk missing",
      "probeNumber: ok missing; isOk missing",
      "probeAny: ok missing; isOk missing",
    ]);
  });
});
