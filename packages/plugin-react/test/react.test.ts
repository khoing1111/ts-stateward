import { describe, expect, it } from "vitest";
import { checkFixture } from "@stateward/core/testing";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

const SHOP = fixture("shop");
const COMPILED = fixture("compiled");

const plugin = react();
/** Plain (non-hook) functions: their own describe below. */
const PLAIN = "Columns.tsx";
const all = (): Shown[] => shown(SHOP, check(SHOP, {}, [plugin]));
const ofRule = (rule: string): Shown[] =>
  all().filter((finding) => finding.rule === rule && finding.file !== PLAIN);

const dependencies: Shown[] = [
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CartBadge.tsx",
    at: "cart.onSave",
    message:
      "`cart.onSave` from `useCart()` is a new function every render, so this effect runs after every render",
    hint: "wrap `onSave` in `useCallback` inside `useCart` (cart.ts:9)",
    notes: [
      "cart.ts: () => api.save(items): `onSave` is created here on every render of `useCart`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CartBadge.tsx",
    at: "cart.clear",
    message:
      "`cart.clear` from `useCart()` is a new function every render, so this callback changes every render",
    hint: "wrap `clear` in `useCallback` inside `useCart` (cart.ts:14)",
    notes: ["cart.ts: clear: `clear` is created here on every render of `useCart`"],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CartBadge.tsx",
    at: "cart.summary",
    message:
      "`cart.summary` from `useCart()` is a new object every render, so this `useMemo` reruns every render",
    hint: "wrap `summary` in `useMemo` inside `useCart` (cart.ts:13)",
    notes: [
      "cart.ts: { count: items.length, total: items.reduce((sum, item) => sum + item.price, 0) }: `summary` is created here on every render of `useCart`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CartList.tsx",
    at: "removeItem",
    message:
      "`removeItem` from `useCart()` is a new function every render, so `<CartRow>` re-renders every time",
    hint: "keep the latest handler in a ref (React's `useEffectEvent`, or your own hook)",
    notes: [
      "cart.ts: (id: string) => {\n    setItems((current) => current.filter((item) => item.id !== id));\n  }: `removeItem` is created here on every render of `useCart`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CartPage.tsx",
    at: "onSave",
    message:
      "`onSave` from `useCart()` is a new function every render, so this effect runs after every render",
    hint: "wrap `onSave` in `useCallback` inside `useCart` (cart.ts:9)",
    notes: [
      "cart.ts: () => api.save(items): `onSave` is created here on every render of `useCart`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "CheckoutPage.tsx",
    at: "save",
    message:
      "`save` from `useCheckout()` is a new function every render, so this effect runs after every render",
    hint: "wrap `onSave` in `useCallback` inside `useCart` (cart.ts:9)",
    notes: [
      "cart.ts: () => api.save(items): `onSave` is created here on every render of `useCart`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "SameFile.tsx",
    at: "toggle",
    message:
      "`toggle` from `useToggle()` is a new function every render, so this effect runs after every render",
    hint: "wrap `toggle` in `useCallback` inside `useToggle` (SameFile.tsx:6)",
    notes: [
      "SameFile.tsx: () => setOn((current) => !current): `toggle` is created here on every render of `useToggle`",
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "unknown",
    file: "SettingsPage.tsx",
    at: "settings",
    message:
      "stateward cannot tell whether `settings` from `useSettings()` is a new value each render",
    hint: "declare `useSettings` as a function at module level (`function useX() { … }`) to make it checkable",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "unknown",
    file: "SettingsPage.tsx",
    at: "profile",
    message:
      "stateward cannot tell whether `profile` from `useProfile()` is a new value each render",
    hint: "`useProfile` gets it from `api.readProfile()` (store.ts:20); wrap that in `useMemo` to make it checkable",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "SignupForm.tsx",
    at: "options",
    message:
      "`options` from `useForm(…)` is a new object every render, so this `useMemo` reruns every render",
    hint: "wrap the object in `useMemo` inside `useForm` (form.ts:12)",
    notes: [
      "form.ts: { validateOnBlur: true, fields: Object.keys(values) }: a new object is created here on every render of `useForm`",
    ],
    fixes: [],
  },
];

const providers: Shown[] = [
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ theme, setTheme }",
    message: "`ThemeContext` gets a new object every render, so all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const themeValue = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "user",
    message: "`UserContext` gets a new object every render, so all its readers re-render",
    hint: "wrap `user` in `useMemo` where it is created (line 18)",
    notes: ["ThemeProvider.tsx: { name }: `user` is created here on every render"],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "[locale, setLocale]",
    message: "`LocaleContext` gets a new array every render, so all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const localeValue = useMemo(() => [locale, setLocale], [locale, setLocale]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "() => onSave()",
    message: "`SaveContext` gets a new function every render, so all its readers re-render",
    hint: "wrap it in `useCallback` and pass that:\n    const saveValue = useCallback(() => onSave(), [onSave]);",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ id, index }",
    message: "`ItemContext` gets a new object every render, so all its readers re-render",
    hint: "extract the item into a component (e.g. `<ItemProvider id={id} index={index}>`) and memoize the value there",
    notes: [],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "item",
    message: "`ItemContext` gets a new object every render, so all its readers re-render",
    hint: "extract the item into a component (e.g. `<ItemProvider id={id} index={index}>`) and memoize the value there",
    notes: ["ThemeProvider.tsx: { id, index }: `item` is created here on every render"],
    fixes: [],
  },
  // an input is new every render, so the fix names it first and writes no `useMemo`.
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ theme, toggle }",
    message: "`ToggleContext` gets a new object every render, so all its readers re-render",
    hint: "stabilise `toggle` first (`useCallback` where it is created, line 74): it is new every render, so a memo of the value would be too",
    notes: ["ThemeProvider.tsx: toggle: `toggle` is created here on every render"],
    fixes: [],
  },
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "toolbar",
    message: "`ToggleContext` gets a new object every render, so all its readers re-render",
    hint: "stabilise `toggle` and `reset` first (`useCallback`, lines 83, 84): they are new every render, so a memo of the value would be too",
    notes: [
      "ThemeProvider.tsx: { theme, toggle: () => toggle(), reset }: `toolbar` is created here on every render",
      'ThemeProvider.tsx: () => setTheme(theme === "light" ? "dark" : "light"): `toggle` is created here on every render',
      'ThemeProvider.tsx: () => setTheme("light"): `reset` is created here on every render',
    ],
    fixes: [],
  },
  // real-world corpus: a rest parameter is new every render, so the memo depends on what is read from it.
  {
    rule: "react/provider-value-changes-every-render",
    severity: "warning",
    file: "ThemeProvider.tsx",
    at: "{ name: props.name }",
    message: "`FieldContext` gets a new object every render, so all its readers re-render",
    hint: "wrap it in `useMemo` and pass that:\n    const fieldValue = useMemo(() => ({ name: props.name }), [props.name]);",
    notes: [],
    fixes: [],
  },
];

const plainCalls: Shown[] = [
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "Columns.tsx",
    at: "columns",
    message:
      "`columns` from `getColumns(\u2026)` is a new array every render, so this effect runs after every render",
    hint: "wrap the call in `useMemo` on its inputs: `useMemo(() => getColumns(prefix), [prefix])`",
    notes: [
      'Columns.tsx: [{ key: `${prefix}-name`, title: "Name" }]: a new array is created here on every call of `getColumns`',
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "Columns.tsx",
    at: "columns",
    message:
      "`columns` from `getColumns(\u2026)` is a new array every render, so `<Table>` re-renders every time",
    hint: "wrap the call in `useMemo` on its inputs: `useMemo(() => getColumns(prefix), [prefix])`",
    notes: [
      'Columns.tsx: [{ key: `${prefix}-name`, title: "Name" }]: a new array is created here on every call of `getColumns`',
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "Columns.tsx",
    at: "columns",
    message:
      "`columns` from `buildColumns(\u2026)` is a new array every render, so this effect runs after every render",
    hint: "`options`, an argument of `buildColumns(options)`, is new every render too: make it stable first, then wrap the call in `useMemo`",
    notes: [
      'Columns.tsx: [{ key: `${options.prefix}-name`, title: "Name" }]: a new array is created here on every call of `buildColumns`',
    ],
    fixes: [],
  },
  {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "Columns.tsx",
    at: "columns",
    message:
      "`columns` from `useColumns(\u2026)` is a new array every render, so this effect runs after every render",
    hint: "wrap the call in `useMemo` inside `useColumns` (Columns.tsx:39), on its inputs: `useMemo(() => getColumns(prefix), [prefix])`",
    notes: [
      "Columns.tsx: getColumns(prefix): `getColumns(prefix)` makes it anew on every render of `useColumns`",
      'Columns.tsx: [{ key: `${prefix}-name`, title: "Name" }]: a new array is created here on every call of `getColumns`',
    ],
    fixes: [],
  },
];

describe("react/dependency-changes-every-render: a cart hook, a checkout hook, a form hook and a factory-made hook", () => {
  it("reports each dependency and memo prop a hook makes anew, in this file or another, with where it is created", () => {
    expect(ofRule("react/dependency-changes-every-render")).toEqual(dependencies);
  });

  it("says nothing of memoized values, setters, primitives and packages' hooks", () => {
    const files = new Set(
      ofRule("react/dependency-changes-every-render").map((finding) => finding.file),
    );
    expect([...files].sort()).toEqual([
      "CartBadge.tsx",
      "CartList.tsx",
      "CartPage.tsx",
      "CheckoutPage.tsx",
      "SameFile.tsx",
      "SettingsPage.tsx",
      "SignupForm.tsx",
    ]);
    const at = ofRule("react/dependency-changes-every-render").map((finding) => finding.at);
    for (const stable of [
      "items",
      "addItem",
      "count",
      "rules",
      "setField",
      "values",
      "values.email",
    ]) {
      expect(at).not.toContain(stable);
    }
  });
});

describe("react: a hook a package makes at module level", () => {
  it("is the package's: no finding, not even unknown (`create<S>()(…)`, `useSelector.withTypes<S>()`)", () => {
    expect(all().filter((finding) => finding.file === "StoreKitPage.tsx")).toEqual([]);
  });
});

describe("react: a value a plain (non-hook) function returns", () => {
  it("is memoized at the call, in the component or in the hook that calls it, never inside the function", () => {
    expect(all().filter((finding) => finding.file === PLAIN)).toEqual(plainCalls);
  });
});

describe("react/provider-value-changes-every-render", () => {
  it("reports an inline or local value given to a Provider, with the memoized code to write", () => {
    expect(ofRule("react/provider-value-changes-every-render")).toEqual(providers);
  });
});

describe("react: the React Compiler", () => {
  it("keeps all three rules silent when the project depends on babel-plugin-react-compiler", () => {
    expect(check(COMPILED, {}, [plugin])).toEqual([]);
  });
});

describe("react: findings", () => {
  it("are warnings, and the same in the same order on a second run", () => {
    const first = checkFixture(SHOP, [react()]).findings;
    expect(checkFixture(SHOP, [react()]).findings).toEqual(first);
    expect(
      first.filter((finding) => finding.kind === "problem").every((f) => f.severity === "warning"),
    ).toBe(true);
  });

  it("are unknown, never a warning, for a hook stateward cannot read", () => {
    expect(
      checkFixture(SHOP, [plugin])
        .findings.filter((finding) => finding.kind === "unknown")
        .map((finding) => finding.message),
    ).toEqual([
      "stateward cannot tell whether `settings` from `useSettings()` is a new value each render",
      "stateward cannot tell whether `profile` from `useProfile()` is a new value each render",
    ]);
  });
});
