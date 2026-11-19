import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard, typeErrors } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";
import { GUARANTEES_TEXT } from "../src/provider-missing/declare-fix.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/declare-guarded", import.meta.url));
/** Under the package, so the copy resolves React from the package's own node_modules. */
const SCRATCH = fileURLToPath(new URL("../.scratch/missing-hint", import.meta.url));
const SLOW = 300_000;

let dir = "";
beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  dir = mkdtempSync(path.join(SCRATCH, "app-"));
  cpSync(FIXTURE, dir, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const hintOf = (project: string): string => {
  const { findings } = checkFixture(project, [reactContext()], {});
  expectMessageStandard(findings);
  const one = findings.find((finding) => finding.ruleId === "react-context/provider-missing");
  if (one === undefined) throw new Error("no finding");
  return one.hint;
};

describe("react-context/provider-missing: the hint states the readings and shows the code", () => {
  it(
    "names `requiredContext` with the context's type, and the line replaces the call and compiles",
    { timeout: SLOW },
    () => {
      const hint = hintOf(dir);
      expect(hint).toContain("- or state it required where it is created");
      expect(hint).toContain("the helper `requiredContext` is in `guarantees.ts`");
      expect(hint).toContain("\n    requiredContext<User>()");
      // The old text is gone.
      expect(hint).not.toContain("value={…}");
      // The line as shown, with the helper and its import where the quick fix puts them.
      const line = /\n {4}(requiredContext<User>\(\))/.exec(hint)?.[1];
      expect(line).toBe("requiredContext<User>()");
      const contexts = path.join(dir, "src", "contexts.ts");
      writeFileSync(path.join(dir, "src", "guarantees.ts"), GUARANTEES_TEXT);
      writeFileSync(
        contexts,
        readFileSync(contexts, "utf8")
          .replace("createContext<User | undefined>(undefined)", line ?? "")
          .replace(
            'import { createContext } from "react";',
            'import { requiredContext } from "./guarantees";',
          ),
      );
      expect(typeErrors(dir)).toBe("");
    },
  );

  it("names the Provider component the project already has, and gives `value` words", () => {
    const children = fileURLToPath(
      new URL("./fixtures/provider-missing/children-variable", import.meta.url),
    );
    const hint = hintOf(children);
    expect(hint).toContain("- wrap it in `<AuthGate>`, which gives `AuthCtx` to its children");
    expect(hint).toContain(
      "- or wrap it in `<AuthCtx.Provider>`, giving its `value` prop what the readers get",
    );
    expect(hint).not.toContain("value={…}");
  });
});
