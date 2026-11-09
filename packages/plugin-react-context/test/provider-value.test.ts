import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, RuleConfig } from "@stateward/core";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

const RULE = "react-context/provider-value-changes-every-render";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/provider-value/${name}`, import.meta.url));
}

/** The rule's findings over a fixture, each held to the message standard. */
function check(dir: string, rules: Record<string, RuleConfig> = {}): readonly Finding[] {
  const { findings } = checkFixture(dir, [reactContext()], rules);
  expectMessageStandard(findings);
  return findings.filter((finding) => finding.ruleId === RULE);
}

/** The parts of a finding a message test compares. */
export type Shown = {
  rule: string;
  severity: string;
  file: string;
  /** The code the finding points at. */
  at: string;
  message: string;
  hint: string;
  notes: string[];
  fixes: string[];
};

const read = (file: string): string => readFileSync(file, "utf8");

export function shown(dir: string, findings: readonly Finding[]): Shown[] {
  const relative = (file: string): string => path.relative(dir, file).split(path.sep).join("/");
  return findings.map((finding) => ({
    rule: finding.ruleId,
    severity: finding.kind === "problem" ? finding.severity : finding.kind,
    file: relative(finding.location.file),
    at: read(finding.location.file).slice(finding.location.start, finding.location.end),
    message: finding.message,
    hint: finding.hint,
    notes:
      finding.kind === "problem"
        ? finding.related.map(
            (related) =>
              `${relative(related.location.file)}: ${read(related.location.file).slice(related.location.start, related.location.end)}: ${related.message}`,
          )
        : [],
    fixes:
      finding.kind === "problem"
        ? finding.fixes.map((fix) =>
            fix.edits
              .map(
                (edit) =>
                  `${relative(edit.location.file)}@${String(edit.location.start)}: ${edit.newText}`,
              )
              .join(" | "),
          )
        : [],
  }));
}

const PLAIN: Shown[] = [
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ theme, setTheme }",
    message: "`ThemeContext` value is a new object every render: all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "user",
    message: "`UserContext` value is a new object every render: all its readers re-render",
    hint: "wrap `user` in `useMemo` where it is created (line 18)",
    notes: ["ThemeProvider.tsx: { name }: `user` is created on every render"],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "[locale, setLocale]",
    message: "`LocaleContext` value is a new array every render: all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const localeValue = useMemo(() => [locale, setLocale], [locale, setLocale]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "() => onSave()",
    message: "`SaveContext` value is a new function every render: all its readers re-render",
    hint: "wrap it in `useCallback` and pass that:\n    const saveValue = useCallback(() => onSave(), [onSave]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ id, index }",
    message: "`ItemContext` value is a new object every render: all its readers re-render",
    hint: "extract the item into a component (e.g. `<ItemProvider id={id} index={index}>`) and memoize the value there",
    notes: [],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "item",
    message: "`ItemContext` value is a new object every render: all its readers re-render",
    hint: "extract the item into a component (e.g. `<ItemProvider id={id} index={index}>`) and memoize the value there",
    notes: ["ThemeProvider.tsx: { id, index }: `item` is created on every render"],
    fixes: [],
  },
  // an input is new every render, so the fix names it first and writes no `useMemo`.
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ theme, toggle }",
    message: "`ToggleContext` value is a new object every render: all its readers re-render",
    hint: "stabilise `toggle` first (`useCallback` where it is created, line 74): it is new every render, so a memo of the value would be new too",
    notes: ["ThemeProvider.tsx: toggle: `toggle` is created on every render"],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "toolbar",
    message: "`ToggleContext` value is a new object every render: all its readers re-render",
    hint: "stabilise `toggle` and `reset` first (`useCallback`, lines 83, 84): they are new every render, so a memo of the value would be new too",
    notes: [
      "ThemeProvider.tsx: { theme, toggle: () => toggle(), reset }: `toolbar` is created on every render",
      'ThemeProvider.tsx: () => setTheme(theme === "light" ? "dark" : "light"): `toggle` is created on every render',
      'ThemeProvider.tsx: () => setTheme("light"): `reset` is created on every render',
    ],
    fixes: [],
  },
  // real-world corpus: a rest parameter is new every render, so the memo depends on what is read from it.
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ name: props.name }",
    message: "`FieldContext` value is a new object every render: all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const fieldValue = useMemo(() => ({ name: props.name }), [props.name]);",
    notes: [],
    fixes: [],
  },
];

const STATED_NOTE =
  "Actions.tsx: ActionsContext: Context<Actions> & Stable = createContext<Actions>(MODULE_ACTIONS): `ActionsContext` is stated `Stable`: its value never changes";

// Not reported: `useMemo` over `dispatch`, `dispatch` itself, a module constant, and
// `useCallback`s over a setter. The last finding is an unstated context: a warning, as before.
const STABLE: Shown[] = [
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "error",
    file: "Actions.tsx",
    at: "{ add: (item) => setItems([item]), clear: () => setItems([]) }",
    message: "`ActionsContext` is stated `Stable`, but its value is a new object every render",
    hint: "one of\n- wrap it in `useMemo` with dependencies that never change (a setter, a `dispatch`, a ref)\n- or remove `Stable` from the type of `ActionsContext`, if its value is meant to change",
    notes: [STATED_NOTE],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "error",
    file: "Actions.tsx",
    at: "actions",
    message: "`ActionsContext` is stated `Stable`, but its value changes when `items` changes",
    hint: "one of\n- build the value only from what never changes (setters, a `dispatch`, refs, module constants), and give `items` to readers through another context\n- or remove `Stable` from the type of `ActionsContext`, if its value is meant to change",
    notes: ["Actions.tsx: items: `items` is state: it changes when it is set", STATED_NOTE],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "error",
    file: "Actions.tsx",
    at: "actions",
    message: "`ActionsContext` is stated `Stable`, but its value changes when `onAdd` changes",
    hint: "one of\n- build the value only from what never changes (setters, a `dispatch`, refs, module constants), and give `onAdd` to readers through another context\n- or remove `Stable` from the type of `ActionsContext`, if its value is meant to change",
    notes: ["Actions.tsx: onAdd: `onAdd` is a prop: the parent can pass a new one", STATED_NOTE],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "error",
    file: "Actions.tsx",
    at: "useActions()",
    message:
      "`ActionsContext` is stated `Stable`, but its value is not proven to stay the same: `useActions()` cannot be followed",
    hint: "one of\n- build the value in the Provider's component from setters, a `dispatch`, refs, module constants, or `useMemo` over them\n- or remove `Stable` from the type of `ActionsContext`, if its value is meant to change",
    notes: [STATED_NOTE],
    fixes: [],
  },
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "warning",
    file: "Actions.tsx",
    at: "{ add: noop, clear: noop }",
    message: "`PlainContext` value is a new object every render: all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const plainValue = useMemo(() => ({ add: noop, clear: noop }), []);",
    notes: [],
    fixes: [],
  },
];

const STORE_NOTE =
  "Store.tsx: StoreContext: Context<Store | null> & Stable = createContext<Store | null>(null): `StoreContext` is stated `Stable`: its value never changes";

/** State whose setter is read: by a call (`UsedSetter`) or through the rest of the tuple. */
const STORE_STATE: Shown = {
  rule: "react-context/provider-value-changes-every-render",
  severity: "error",
  file: "Store.tsx",
  at: "store",
  message: "`StoreContext` is stated `Stable`, but its value changes when `store` changes",
  hint: "one of\n- build the value only from what never changes (setters, a `dispatch`, refs, module constants), and give `store` to readers through another context\n- or remove `Stable` from the type of `StoreContext`, if its value is meant to change",
  notes: ["Store.tsx: store: `store` is state: it changes when it is set", STORE_NOTE],
  fixes: [],
};

// Not reported: state with no setter taken, a setter bound and never read, a reducer with no
// `dispatch` taken. `ref.current` changes, as before.
const STORE: Shown[] = [
  STORE_STATE,
  STORE_STATE,
  {
    rule: "react-context/provider-value-changes-every-render",
    severity: "error",
    file: "Store.tsx",
    at: "ref.current",
    message: "`StoreContext` is stated `Stable`, but its value changes when `ref.current` changes",
    hint: "one of\n- build the value only from what never changes (setters, a `dispatch`, refs, module constants), and give `ref.current` to readers through another context\n- or remove `Stable` from the type of `StoreContext`, if its value is meant to change",
    notes: [STORE_NOTE],
    fixes: [],
  },
];

describe("react-context/provider-value-changes-every-render", () => {
  it("reports an inline or local value given to a Provider, with the memoized code to write", () => {
    const dir = fixture("plain");
    expect(shown(dir, check(dir))).toEqual(PLAIN);
  });

  it("`ignore`: a context named there is not reported", () => {
    const dir = fixture("plain");
    const options = { ignore: ["ItemContext", "Theme*", "Toggle*", "Field*"] };
    expect(check(dir, { [RULE]: ["warning", options] })).toHaveLength(3);
  });

  it("holds a context stated Stable to a value that never changes: anything else is an error", () => {
    const dir = fixture("stable");
    expect(shown(dir, check(dir))).toEqual([...STABLE, ...STORE]);
  });

  it("is silent when the project uses the React Compiler, except for a context stated Stable", () => {
    // The compiler keeps a literal by what it reads: one that reads state still changes.
    const dir = fixture("compiled");
    expect(shown(dir, check(dir)).map((finding) => [finding.file, finding.message])).toEqual([
      [
        "Stable.tsx",
        "`ActionsContext` is stated `Stable`, but its value changes when `items` changes",
      ],
    ]);
  });
});
