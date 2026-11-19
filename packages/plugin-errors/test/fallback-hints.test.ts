import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import {
  checkOnly,
  checkWith,
  exampleBlocks,
  fixture,
  inCopy,
  shown,
  stringList,
} from "./helpers.js";
import type { Replacement } from "./helpers.js";

const RULE = "catch-misses-error";
const DIR = fixture("react-boundaries/fallbacks");
const found = checkOnly(DIR, RULE);

const BRANCH = ["    if (error instanceof ParseError) {", "      …", "    }"];
const IGNORE = [
  "- or if `ParseError` needs no branch, list it under the rule's `ignoreClasses` option:",
  '    { ignoreClasses: ["ParseError"] }',
];
const hintOf = (rest: readonly string[]): string =>
  ["one of", "- add a branch for it:", ...BRANCH, ...rest, ...IGNORE].join("\n");

describe(`errors/${RULE} on a boundary's fallback: the ways to fix it`, () => {
  it("offers a branch, a branch for the rest in the fallback's own shape, and the option", () => {
    expect(shown(found).map((one) => [one.message, one.hint])).toEqual([
      [
        "`Fallback` does not handle `ParseError`, which its boundary can catch",
        hintOf([
          "- or end with one for any other error:",
          "    return <p>Something went wrong: {String(error)}</p>;",
        ]),
      ],
      [
        "`fallbackRender` does not handle `ParseError`, which its boundary can catch",
        hintOf([
          "- or end with one for any other error:",
          "    return <p>Something went wrong: {String(error)}</p>;",
        ]),
      ],
      [
        "`onError` does not handle `ParseError`, which its boundary can catch",
        hintOf(["- or end with one for any other error:", "    console.error(error);"]),
      ],
      [
        "`Guard.getDerivedStateFromError` does not handle `ParseError`, which its boundary can catch",
        hintOf([
          "- or end with one for any other error, returning the state the boundary shows for a failure",
        ]),
      ],
    ]);
  });

  it("no longer writes a state of its own invention for `getDerivedStateFromError`", () => {
    for (const finding of found) {
      expect(finding.hint).not.toContain("return { error: error };");
      expect(finding.hint).not.toContain("add a branch for it, or end with one");
    }
  });
});

/** Where each fallback's code is, and what the shown lines become there (the `…` is filled in). */
const CASES = [
  {
    file: "Fallback.tsx",
    chain: "if (error instanceof AuthError)",
    body: "return <p>The settings are damaged.</p>;",
    tail: "return null;",
  },
  {
    file: "App.tsx",
    chain: "if (error instanceof AuthError) return <p>Please sign in.</p>;",
    body: "return <p>The settings are damaged.</p>;",
    tail: "return null;",
  },
  {
    file: "App.tsx",
    chain: "if (error instanceof AuthError) console.warn",
    body: 'console.warn("damaged");',
    tail: 'console.warn("signed out");',
  },
  {
    file: "Guard.tsx",
    chain: "if (error instanceof AuthError)",
    body: "return null;",
    tail: undefined,
  },
] as const;

function at(file: string): string {
  return path.join(DIR, "src", file);
}

/** The branch the first way shows, with its `…` filled in, put before the chain. */
function branchAt(finding: Finding, spec: (typeof CASES)[number]): Replacement {
  const [shownBranch = []] = exampleBlocks(finding.hint);
  const text = readFileSync(at(spec.file), "utf8");
  const start = text.indexOf(spec.chain);
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = shownBranch.map((line) => (line.trim() === "…" ? `  ${spec.body}` : line));
  return { file: at(spec.file), start, end: start, text: `${lines.join("\n")}\n` };
}

describe(`errors/${RULE} on a boundary's fallback: the code the hint shows works there`, () => {
  it("compiles the branch in each fallback, and the fallback then handles the class", () => {
    expect(found).toHaveLength(CASES.length);
    found.forEach((finding, index) => {
      const spec = CASES[index];
      if (spec === undefined) throw new Error("a case for each finding");
      const replacement = branchAt(finding, spec);
      const withImport: Replacement = {
        file: replacement.file,
        start: 0,
        end: 0,
        text: 'import { ParseError } from "./errors";\n',
      };
      inCopy(DIR, [withImport, replacement], (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(checkOnly(copy, RULE)).toHaveLength(CASES.length - 1);
      });
    });
  });

  it("compiles the branch for any other error where it is shown, and the fallback then handles every class", () => {
    found.forEach((finding, index) => {
      const spec = CASES[index];
      const blocks = exampleBlocks(finding.hint);
      // The first block is the branch, the second the line for any other error (none for the state).
      const rest = blocks.length === 3 ? blocks[1] : undefined;
      if (spec?.tail === undefined) {
        expect(rest).toBeUndefined();
        return;
      }
      expect(rest).toBeDefined();
      const file = at(spec.file);
      const text = readFileSync(file, "utf8");
      const chainStart = text.indexOf(spec.chain);
      const tailStart = text.indexOf(spec.tail, chainStart);
      expect(tailStart).toBeGreaterThanOrEqual(0);
      // `return null;` is replaced by the line; the `onError` chain gets it after its last statement.
      const replacement: Replacement = spec.tail.startsWith("return")
        ? { file, start: tailStart, end: tailStart + spec.tail.length, text: rest?.[0] ?? "" }
        : {
            file,
            start: tailStart + spec.tail.length,
            end: tailStart + spec.tail.length,
            text: `\n        ${rest?.[0] ?? ""}`,
          };
      inCopy(DIR, [replacement], (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(checkOnly(copy, RULE)).toHaveLength(CASES.length - 1);
      });
    });
  });

  it("is silent when the class is listed under `ignoreClasses` as the hint shows", () => {
    const [finding] = found;
    const listed = (finding?.hint ?? "").split("\n").at(-1)?.trim() ?? "";
    expect(listed).toBe('{ ignoreClasses: ["ParseError"] }');
    const ignoreClasses = stringList(listed.replace(/^\{ ignoreClasses: /, "").replace(/ \}$/, ""));
    expect(ignoreClasses).toEqual(["ParseError"]);
    expect(checkWith(DIR, RULE, ["error", { ignoreClasses }])).toEqual([]);
  });
});
