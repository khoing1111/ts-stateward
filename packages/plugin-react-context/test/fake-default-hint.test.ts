import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFixture, typeErrors } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";
import { GUARANTEES_TEXT } from "../src/provider-missing/declare-fix.js";

/** Under the package, so the project resolves React from the package's own node_modules. */
const SCRATCH = fileURLToPath(new URL("../.scratch/fake-default-hint", import.meta.url));
const SLOW = 300_000;

let dir = "";
beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  dir = mkdtempSync(path.join(SCRATCH, "app-"));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        jsx: "react-jsx",
        noEmit: true,
        types: [],
      },
      include: ["*.ts", "*.tsx"],
    }),
  );
  writeFileSync(path.join(dir, "guarantees.ts"), GUARANTEES_TEXT);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, text: string): void => {
  writeFileSync(path.join(dir, name), text);
};

describe("react-context/fake-default-value: the code the hint shows compiles where it is written", () => {
  it(
    "`requiredContext<Theme>()` replaces the cast call, and the `undefined` form is a context too",
    { timeout: SLOW },
    () => {
      const before = [
        'import { createContext } from "react";',
        "",
        "export type Theme = { color: string };",
        "",
        "export const ThemeContext = createContext<Theme>({} as Theme);",
        "",
      ].join("\n");
      write("contexts.ts", before);
      const { findings } = checkFixture(dir, [reactContext()], {});
      const hint = findings.find((one) => one.ruleId === "react-context/fake-default-value")?.hint;
      expect(hint).toContain("a helper you add once in `guarantees.ts`");
      // Neither fix is claimed where it is not offered.
      expect(hint).not.toContain("the quick fix of");
      expect(hint).not.toContain("useTheme");
      const blocks = (hint ?? "").split("\n").filter((line) => line.startsWith("    "));
      expect(blocks.map((line) => line.slice(4))).toEqual([
        "requiredContext<Theme>()",
        "const ThemeContext = createContext<Theme | undefined>(undefined);",
        '// the hook that reads it: throw when the value is undefined, as "ThemeContext needs a Provider"',
      ]);
      write(
        "contexts.ts",
        before
          .replace("createContext<Theme>({} as Theme)", "requiredContext<Theme>()")
          .replace(
            'import { createContext } from "react";',
            'import { requiredContext } from "./guarantees.js";',
          ),
      );
      expect(typeErrors(dir)).toBe("");
      write(
        "contexts.ts",
        before.replace(
          "export const ThemeContext = createContext<Theme>({} as Theme);",
          "export const ThemeContext = createContext<Theme | undefined>(undefined);",
        ),
      );
      expect(typeErrors(dir)).toBe("");
    },
  );
});
