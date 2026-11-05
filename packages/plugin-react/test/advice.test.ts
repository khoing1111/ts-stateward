import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createChecker, parseConfig, type OptionValue, type RuleConfig } from "@stateward/core";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

/** The fix line that matches why a value is new. */
const ADVICE = fixture("advice");

const RULE = "react/dependency-changes-every-render";

const ofRule = (options: Record<string, OptionValue> = {}): Shown[] =>
  shown(ADVICE, check(ADVICE, { [RULE]: ["warning", options] })).filter(
    (finding) => finding.rule === RULE,
  );

const found = (
  at: string,
  message: string,
  hint: string,
  note: string,
  extra: Partial<Shown> = {},
): Shown => ({
  rule: RULE,
  severity: "warning",
  file: "Page.tsx",
  at,
  message,
  hint,
  notes: [`hooks.ts: ${note}`],
  fixes: [],
  ...extra,
});

const MOVE_FIX =
  'hooks.ts@258: const onSkip = () => {\n  console.info("skipped");\n};\n\n | hooks.ts@344: ';

const skip = found(
  "onSkip",
  "`onSkip` from `useSkip()` is a new function every render, so this effect runs after every render",
  "move `onSkip` to module scope; it then never changes (quick fix)",
  '() => {\n    console.info("skipped");\n  }: `onSkip` is created here on every render of `useSkip`',
  { fixes: [MOVE_FIX] },
);
const log = found(
  "onLog",
  "`onLog` from `useLog()` is a new function every render, so this effect runs after every render",
  "move `onLog` to module scope; it then never changes",
  '() => console.info("logged"): `onLog` is created here on every render of `useLog`',
);
const index = found(
  "index",
  "`index` from `resolveIndexState(…)` is a new object every render, so this effect runs after every render",
  "wrap the call in `useMemo` on its inputs: `useMemo(() => resolveIndexState(urlState, saved), [urlState, saved])`",
  "{ page: urlState.length, filter: saved.filter }: a new object is created here on every call of `resolveIndexState`",
);
const undo = found(
  "onUndo",
  "`onUndo` from `useUndo(…)` is a new function every render, so this effect runs after every render",
  "make `entries` and `position` parameters of `onUndo` and pass them where it is called",
  "() => restore(entries, position): `onUndo` is created here on every render of `useUndo`",
);
const toolbar = found(
  "onUndo",
  "`onUndo` from `useUndo(…)` is a new function every render, so `<Toolbar>` re-renders every time",
  "wrap `onUndo` in `useCallback` inside `useUndo` (hooks.ts:25)",
  "() => restore(entries, position): `onUndo` is created here on every render of `useUndo`",
);
const select = found(
  "onSelect",
  "`onSelect` from `useRows()` is a new function every render, so `<RowList>` re-renders every time",
  "keep the latest handler in a ref (React's `useEffectEvent`, or your own hook)",
  "(id: string) => setRows(rows.filter((row) => row !== id)): `onSelect` is created here on every render of `useRows`",
);
const swatch = found(
  "swatch",
  "`swatch` from `useColor()` is built from `hsva`, so it changes whenever that does",
  "stabilising it gains nothing: it really changes with `hsva`",
  "{ hue: hsva.h, shade: hsva.v }: `swatch` is created here on every render of `useColor`",
  { severity: "info" },
);

describe("react/dependency-changes-every-render: advice that matches the cause", () => {
  it("moves a closure that captures nothing to module scope, as a quick fix when the move is mechanical", () => {
    expect(ofRule().slice(0, 2)).toEqual([skip, log]);
  });
  it("wraps a fresh result of a function of the project in `useMemo` on its inputs", () => {
    expect(ofRule()[2]).toEqual(index);
  });
  it("makes the captured parameters parameters of the closure, only when project code calls it", () => {
    expect(ofRule().slice(3, 5)).toEqual([undo, toolbar]);
  });
  it("keeps the latest handler in a ref for an `on…` prop of a `memo` child", () => {
    expect(ofRule()[5]).toEqual(select);
  });
  it("names the project's hook for it when `stableHooks` lists one", () => {
    expect(ofRule({ stableHooks: ["use*Store", "useLatestHandler"] })[5]).toEqual({
      ...select,
      hint: "keep the latest handler in a ref with `useLatestHandler`",
    });
  });
  it("reports a value built from the state behind the render as info: stabilising gains nothing", () => {
    expect(ofRule()[6]).toEqual(swatch);
    expect(ofRule()).toHaveLength(7);
  });
  it("lets the config change the severity of that kind", () => {
    expect(ofRule({ severities: { derived: "warning" } })[6]?.severity).toBe("warning");
    expect(ofRule({ severities: { derived: "off" } })).toHaveLength(6);
  });
});

describe("one `stableHooks` setting for react/dependency-changes-every-render and react/effect-response-race", () => {
  const REDUX = fixture("real-b-redux");
  const RACE = "react/effect-response-race";
  const raced = (rules: Record<string, RuleConfig>): string[] =>
    shown(REDUX, check(REDUX, rules, [react()], ["react/effect-race"]))
      .filter((finding) => finding.rule === RACE)
      .map((finding) => finding.at);

  it("is read by the race rule from the setting on dependency-changes-every-render", () => {
    expect(raced({ [RACE]: ["warning", {}] })).toHaveLength(3);
    expect(
      raced({ [RACE]: ["warning", {}], [RULE]: ["warning", { stableHooks: ["use*Store"] }] }),
    ).toEqual(["setOrders(found.filter((order) => order.includes(filter)))"]);
  });
});

describe("the quick fix that moves a closure to module scope", () => {
  it("is offered after it compiles, and leaves the hook returning the same name", () => {
    const parsed = parseConfig({ plugins: [react()], rules: { [RULE]: "warning" } }, ADVICE);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: ADVICE });
    const ours = checker.check().findings.filter((one) => one.ruleId === RULE);
    const fixes = checker
      .reviewFixes(ours)
      .flatMap((review) => (review.finding.kind === "problem" ? review.finding.fixes : []));
    expect(fixes.map((fix) => fix.title)).toEqual(["Move `onSkip` to module scope"]);
    const text = readFileSync(path.join(ADVICE, "hooks.ts"), "utf8");
    const result = [...(fixes[0]?.edits ?? [])]
      .sort((a, b) => b.location.start - a.location.start)
      .reduce(
        (done, edit) =>
          done.slice(0, edit.location.start) + edit.newText + done.slice(edit.location.end),
        text,
      );
    expect(result).toContain(
      '}\n\nconst onSkip = () => {\n  console.info("skipped");\n};\n\n/** Uses nothing from the hook: moves to module scope. */\nexport function useSkip() {\n  return { onSkip };\n}',
    );
  });
});
