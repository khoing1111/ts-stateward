import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, Location, Plugin, ProjectRule, RuleConfig } from "@stateward/core";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";
import { createProviderMissing } from "../src/provider-missing/rule.js";
import type { Summary } from "../src/provider-missing/summary.js";
import { createProviderNested } from "../src/provider-nested/rule.js";

const RULE = "react-context/provider-nested";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/provider-nested/${name}`, import.meta.url));
}

function where(location: Location, dir: string): string {
  const line = readFileSync(location.file, "utf8").slice(0, location.start).split("\n").length;
  return `${path.relative(dir, location.file).split(path.sep).join("/")}:${String(line)}`;
}

/** A finding as the CLI shows it: severity, place, headline, fix and notes in order. */
function show(finding: Finding, dir: string): string[] {
  const head = `${finding.kind === "problem" ? finding.severity : "info"} ${where(finding.location, dir)}: ${finding.message}`;
  const notes =
    finding.kind === "problem"
      ? finding.related.map((note) => `note ${where(note.location, dir)}: ${note.message}`)
      : [];
  return [head, `fix: ${finding.hint}`, ...notes];
}

function run(
  name: string,
  rules: Record<string, RuleConfig> = {},
): { all: readonly Finding[]; shown: string[][] } {
  const dir = fixture(name);
  const { findings } = checkFixture(dir, [reactContext()], rules);
  expectMessageStandard(findings);
  const mine = findings.filter((finding) => finding.ruleId === RULE);
  return { all: findings, shown: mine.map((finding) => show(finding, dir)) };
}

const FIX_RENDER = [
  "fix: one of",
  "- remove `<StoreProvider>` here, so the components inside it read the outer `StoreContext` value",
  "- or remove `SingleProvider` from the type of `StoreContext`, if a second value for part of the tree is intended",
].join("\n");
const FIX_LOCAL = [
  "fix: one of",
  "- remove the inner Provider, so its readers get the outer one's value",
  "- or remove `SingleProvider` from the type of `CacheContext`, if a second value for part of the tree is intended",
].join("\n");
const STORE =
  "note src/contexts.ts:9: `StoreContext` is stated `SingleProvider`: one Provider on any render path";
const CACHE =
  "note src/contexts.ts:18: `CacheContext` is stated `SingleProvider`: one Provider on any render path";

describe("react-context/provider-nested", () => {
  it("reports a Provider of a SingleProvider context under another, with the outer one as a note", () => {
    expect(run("app").shown).toEqual([
      // Under the store main.tsx renders, through `children` of `<StoreProvider>`.
      [
        "error src/App.tsx:12: `<StoreProvider>` renders a second `StoreContext` Provider under the first",
        FIX_RENDER,
        "note src/main.tsx:9: `<App>` is inside `<StoreProvider>`, which provides `StoreContext`",
        "note src/Store.tsx:6: the inner `StoreContext` Provider",
        STORE,
      ],
      // Two in the same JSX, on a context with a default value.
      [
        "error src/App.tsx:22: `<CacheContext>` is rendered under another `CacheContext` Provider",
        FIX_LOCAL,
        "note src/App.tsx:21: the outer `CacheContext` Provider",
        CACHE,
      ],
      // Given to `<Layout>`, which renders its children inside its own store.
      [
        "error src/App.tsx:31: `<StoreProvider>` renders a second `StoreContext` Provider under the first",
        FIX_RENDER,
        "note src/Store.tsx:14: the outer `StoreContext` Provider, which `<Layout>` renders around it",
        "note src/Store.tsx:6: the inner `StoreContext` Provider",
        STORE,
      ],
      // In a component nothing renders: its own JSX is still checked.
      [
        "error src/App.tsx:71: `<CacheContext>` is rendered under another `CacheContext` Provider",
        FIX_LOCAL,
        "note src/App.tsx:70: the outer `CacheContext` Provider",
        CACHE,
      ],
      // Outside any component: the trait is stated, so what cannot be followed is an error.
      [
        "error src/App.tsx:78: `<CacheContext>` is outside any component: whether another `CacheContext` Provider is above it is not proven",
        "fix: render it in a component's JSX, so stateward can follow where it renders",
        CACHE,
      ],
    ]);
  });

  it("combines with RequiredContext: the stated-required context is proven, its single Provider too", () => {
    const { all } = run("app");
    expect(all.filter((finding) => finding.ruleId === "react-context/provider-missing")).toEqual(
      [],
    );
  });

  it("says nothing about a context that does not state SingleProvider (nested themes)", () => {
    expect(
      run("app")
        .shown.flat()
        .some((line) => line.includes("ThemeContext")),
    ).toBe(false);
  });

  it("`ignore`: a context named there is not reported", () => {
    const rules = { [RULE]: ["error", { ignore: ["Cache*"] }] } as const;
    expect(run("app", rules).shown.map((lines) => lines[0])).toEqual([
      "error src/App.tsx:12: `<StoreProvider>` renders a second `StoreContext` Provider under the first",
      "error src/App.tsx:31: `<StoreProvider>` renders a second `StoreContext` Provider under the first",
    ]);
  });

  it("gives the same findings in the same order on a second run", () => {
    const dir = fixture("app");
    const first = checkFixture(dir, [reactContext()]).findings;
    expect(checkFixture(dir, [reactContext()]).findings).toEqual(first);
  });

  it("reads each file once for provider-missing and provider-nested: both get the same summary", () => {
    const seen = new Map<string, Summary[]>();
    const spied = (rule: ProjectRule<Summary>): ProjectRule<Summary> => ({
      ...rule,
      summarize(ctx) {
        const summary = rule.summarize(ctx);
        if (summary !== undefined) seen.set(ctx.file, [...(seen.get(ctx.file) ?? []), summary]);
        return summary;
      },
    });
    const spy: Plugin = {
      name: "react-context",
      description: "spy",
      rules: {
        "provider-missing": spied(createProviderMissing([])),
        "provider-nested": spied(createProviderNested([])),
      },
    };
    checkFixture(fixture("app"), [spy]);
    expect(seen.size).toBeGreaterThan(0);
    for (const [first, second, ...rest] of seen.values()) {
      expect(rest).toEqual([]);
      expect(second).toBe(first);
    }
  });
});
