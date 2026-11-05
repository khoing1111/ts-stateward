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
  dir = mkdtempSync(path.join(tmpdir(), "stateward-errortype-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Reports each element of an array literal as `error` or `ok`. */
const errorProbe: FileRule = {
  kind: "file",
  meta,
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
          const text = ctx.types.isErrorType(element) ? "error" : "ok";
          ctx.report({
            node: element,
            hint: "probe hint",
            message: `${element.getText()}: ${text}`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

describe("TypeQueries.isErrorType", () => {
  it("is true for a type from an unresolved import, false for a written any or a string", () => {
    writeFileSync(path.join(dir, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(
      path.join(dir, "a.ts"),
      'import { Key } from "missing-package";\ndeclare const written: any;\ndeclare const k: Key;\nexport const all = [k, written, "s"];\n',
    );
    const { findings } = checkFixture(dir, [plugin({ probe: errorProbe })]);
    expect(
      findings.filter((one) => one.ruleId.endsWith("probe")).map((one) => one.message),
    ).toEqual(["k: error", "written: ok", '"s": ok']);
  });
});
