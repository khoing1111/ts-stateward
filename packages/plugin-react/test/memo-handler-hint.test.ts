import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import { check, fixture, inCopy, shown } from "./helpers.js";

const ADVICE = fixture("advice");
const RULE = "react/dependency-changes-every-render";
const HOOKS = `${ADVICE}/hooks.ts`;
const SOURCE = readFileSync(HOOKS, "utf8");
const HANDLER = "const onSelect = (id: string) => setRows(rows.filter((row) => row !== id));";
const START = SOURCE.indexOf(HANDLER);

const onSelect = (dir: string, options: Record<string, string[]> = {}) =>
  shown(dir, check(dir, { [RULE]: ["warning", options] })).filter(
    (one) => one.rule === RULE && one.at === "onSelect",
  );

describe(`${RULE}: a handler for a memo child`, () => {
  it("does not offer React's `useEffectEvent`, which cannot be passed to other components", () => {
    const [one] = onSelect(ADVICE);
    expect(one?.hint).not.toContain("useEffectEvent");
    expect(one?.hint).toContain("`useCallback` inside `useRows`");
  });

  it("the `useCallback` it offers stops the finding, in the hook where the handler is created", () => {
    const text =
      "const onSelect = useCallback((id: string) => setRows(rows.filter((row) => row !== id)), [rows]);";
    const replacement = { file: HOOKS, start: START, end: START + HANDLER.length, text };
    inCopy(
      ADVICE,
      [
        {
          file: HOOKS,
          start: 0,
          end: SOURCE.indexOf("\n"),
          text: 'import { useCallback, useState } from "react";',
        },
        replacement,
      ],
      (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(onSelect(copy)).toEqual([]);
      },
    );
  });

  it("the own hook it offers stops the finding once it is named in `stableHooks`", () => {
    const text =
      "const onSelect = useLatestHandler((id: string) => setRows(rows.filter((row) => row !== id)));";
    const declare = "\ndeclare function useLatestHandler<T>(handler: T): T;\n";
    const edits = [
      { file: HOOKS, start: START, end: START + HANDLER.length, text },
      { file: HOOKS, start: SOURCE.indexOf("\n"), end: SOURCE.indexOf("\n"), text: declare },
    ];
    inCopy(ADVICE, edits, (copy) => {
      expect(typeErrors(copy)).toBe("");
      expect(onSelect(copy, { stableHooks: ["useLatestHandler"] })).toEqual([]);
      expect(onSelect(copy).map((one) => one.message)).not.toEqual([]);
    });
  });
});
