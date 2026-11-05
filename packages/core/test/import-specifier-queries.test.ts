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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-import-specifier-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * For every variable named `probe*`: the alias of its initializer's type, and where `target.ts`
 * would import it from (the table fix adds the domain type's import).
 */
const importProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith("probe") &&
        node.initializer !== undefined
      ) {
        const alias = ctx.types.typeAliasOf(node.initializer);
        const from = path.join(path.dirname(ctx.file), "target.ts");
        const specifier = alias && ctx.types.importSpecifierFor(alias, from);
        const shown = alias ? `${alias.name}@${path.basename(alias.file)}` : "none";
        ctx.report({
          node,
          hint: "probe hint",
          message: `${node.name.text}: ${shown} from ${specifier ?? "nowhere"}`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

function project(resolution: string, sources: Record<string, string>): string[] {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: resolution === "Bundler" ? "ESNext" : resolution,
        moduleResolution: resolution,
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      include: ["**/*.ts"],
    }),
  );
  for (const [name, text] of Object.entries(sources)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return checkFixture(dir, [plugin({ probe: importProbe })])
    .findings.filter((f) => path.basename(f.location.file) === "a.ts")
    .map((f) => f.message);
}

const SOURCES = {
  "domain/status.ts": [
    'export type TouchpointStatus = "open" | "closed";',
    'type Hidden = "a" | "b";',
    "export type Box<T> = { value: T };",
    "export declare function touchpointStatus(): TouchpointStatus;",
    "export declare function hidden(): Hidden;",
    "export declare function box(): Box<number>;",
  ].join("\n"),
  "domain/index.ts": 'export type { TouchpointStatus } from "./status.js";\n',
};

describe("TypeQueries.typeAliasOf and importSpecifierFor", () => {
  it("names a returned alias and the relative path that imports it, ending as NodeNext needs", () => {
    expect(
      project("NodeNext", {
        ...SOURCES,
        "target.ts": "export {};\n",
        "a.ts": [
          'import { touchpointStatus, hidden, box } from "./domain/status.js";',
          "export const probeStatus = touchpointStatus();",
          "export const probeHidden = hidden();",
          "export const probeBox = box();",
          "export const probeNumber = 1;",
        ].join("\n"),
      }),
    ).toEqual([
      "probeStatus: TouchpointStatus@status.ts from ./domain/status.js",
      "probeHidden: Hidden@status.ts from nowhere",
      "probeBox: none from nowhere",
      "probeNumber: none from nowhere",
    ]);
  });

  it("ends a specifier as the importing file's own relative imports do", () => {
    expect(
      project("Bundler", {
        ...SOURCES,
        "target.ts": 'import "./other";\nexport {};\n',
        "other.ts": "export {};\n",
        "a.ts": [
          'import { touchpointStatus } from "./domain/status";',
          "export const probeStatus = touchpointStatus();",
        ].join("\n"),
      }),
    ).toEqual(["probeStatus: TouchpointStatus@status.ts from ./domain/status"]);
  });

  it("names a package by its name when its entry exports the alias", () => {
    expect(
      project("NodeNext", {
        "node_modules/statuses/package.json": JSON.stringify({
          name: "statuses",
          types: "index.d.ts",
        }),
        "node_modules/statuses/index.d.ts": [
          'export type Phase = "draft" | "live";',
          "export declare function phase(): Phase;",
        ].join("\n"),
        "target.ts": "export {};\n",
        "a.ts": ['import { phase } from "statuses";', "export const probePhase = phase();"].join(
          "\n",
        ),
      }),
    ).toEqual(["probePhase: Phase@index.d.ts from statuses"]);
  });
});
