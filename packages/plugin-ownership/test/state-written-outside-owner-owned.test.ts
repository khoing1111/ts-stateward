import { describe, expect, it } from "vitest";
import { checkFixture } from "@stateward/core/testing";
import type { Finding, RuleConfig } from "@stateward/core";
import { ownership } from "../src/index.js";
import { check, fixture, shown } from "./helpers.js";

const OWNED = fixture("state-written-outside-owner/owned");
const RULE = "ownership/state-written-outside-owner";

/** Each finding as `<file> <code>: <headline>`. */
function lines(findings: readonly Finding[]): string[] {
  return shown(OWNED, findings).map((one) => `${one.file} ${one.at}: ${one.message}`);
}

function find(findings: readonly Finding[], file: string, at: string) {
  const found = shown(OWNED, findings).find((one) => one.file === file && one.at === at);
  if (found === undefined) throw new Error(`no finding at ${file} ${at}`);
  return found;
}

const SETTINGS_STATED = "settings: `settings` is declared owned: only `settings.ts` may change it";

describe("ownership/state-written-outside-owner: values stated `Owned`", () => {
  const findings = check(OWNED);

  it("reports every change from another module, and every place it cannot follow, in file order", () => {
    expect(lines(findings)).toEqual([
      // A local alias, a destructured part, a function that returns it, a callback's element.
      "alias.ts s.fontSize: `settings` is changed outside its owner, `settings.ts`",
      "alias.ts tags.pop: `settings` is changed outside its owner, `settings.ts`",
      "alias.ts getSettings().theme: `settings` is changed outside its owner, `settings.ts`",
      "alias.ts picked.theme: `settings` is changed outside its owner, `settings.ts`",
      "alias.ts Store.items[0]: `Store.items` is changed outside its owner, `store.ts`",
      "alias.ts job.done: `jobs` is changed outside its owner, `store.ts`",
      "alias.ts job.done: `jobs` is changed outside its owner, `store.ts`",
      // A cast that drops the type, one through `unknown`, and `any`, which cannot be followed.
      "cast.ts (settings as Loose).theme: `settings` is changed outside its owner, `settings.ts`",
      "cast.ts (registry as unknown as Map<string, number>).delete: `registry` is changed outside its owner, `mine.ts`",
      'cast.ts (registry as any).set: not checked: whether `(registry as any).set("b", 2)` changes `registry`, owned by `mine.ts`',
      "direct.ts settings.theme: `settings` is changed outside its owner, `settings.ts`",
      // Changing methods, `Object.assign`, `delete`, a static, replacing a static.
      "methods.ts settings.tags.push: `settings` is changed outside its owner, `settings.ts`",
      "methods.ts registry.set: `registry` is changed outside its owner, `mine.ts`",
      "methods.ts settings: `settings` is changed outside its owner, `settings.ts`",
      "methods.ts settings.extra: `settings` is changed outside its owner, `settings.ts`",
      "methods.ts Store.items.push: `Store.items` is changed outside its owner, `store.ts`",
      "methods.ts Store.items: `Store.items` is changed outside its owner, `store.ts`",
      // A parameter typed `Owned`: stateward cannot tell whose it is.
      "param.ts target.theme: not checked: whose `target` is, in `param.ts`: it is typed `Owned`, but its declaration is not found",
      // Handed to a function of another module that changes it; to a function it cannot tell.
      "passes.ts settings: `settings` is changed outside its owner, `settings.ts`",
      "passes.ts settings: not checked: whether `handlers[name](…)` changes `settings`, owned by `settings.ts`",
      // Through a re-export, renamed, and a namespace import of it.
      "reexport.ts appSettings.fontSize: `settings` is changed outside its owner, `settings.ts`",
      "reexport.ts all.registry.clear: `registry` is changed outside its owner, `mine.ts`",
      // The owner hands its own value to another module's function that changes it.
      "settings.ts settings: `settings` is changed outside its owner, `settings.ts`",
    ]);
  });

  it("is silent on the owner's own writes, reads, copies, readonly parameters and the owner's functions", () => {
    const files = new Set(shown(OWNED, findings).map((one) => one.file));
    for (const quiet of ["store.ts", "mine.ts", "reader.ts", "apply.ts", "index.ts"]) {
      expect(files.has(quiet)).toBe(false);
    }
    // In settings.ts, only the value it hands to `apply`.
    expect(lines(findings).filter((line) => line.startsWith("settings.ts"))).toHaveLength(1);
  });

  it("names the owner's functions that make the same change, and the path as notes", () => {
    expect(find(findings, "direct.ts", "settings.theme")).toEqual({
      file: "direct.ts",
      at: "settings.theme",
      message: "`settings` is changed outside its owner, `settings.ts`",
      hint: "call `setTheme` from `settings.ts` instead: it owns the value",
      notes: [SETTINGS_STATED],
    });
    expect(find(findings, "alias.ts", "s.fontSize").notes).toEqual([
      "s: `s` is `settings`",
      SETTINGS_STATED,
    ]);
    expect(find(findings, "alias.ts", "getSettings().theme").notes).toEqual([
      "settings: `getSettings` returns `settings`",
      SETTINGS_STATED,
    ]);
    expect(find(findings, "alias.ts", "Store.items[0]").hint).toBe(
      "call `Store.add` from `store.ts` instead: it owns the value",
    );
    const elements = shown(OWNED, findings).filter((one) => one.at === "job.done");
    expect(elements.map((one) => one.notes)).toEqual([
      [
        "job: `job` is an element of `jobs`",
        "jobs: `jobs` is declared owned: only `store.ts` may change it",
      ],
      [
        "job: `job` is an element of `jobs`",
        "jobs: `jobs` is declared owned: only `store.ts` may change it",
      ],
    ]);
    expect(elements[0]?.hint).toBe("call `finishAll` from `store.ts` instead: it owns the value");
    expect(find(findings, "passes.ts", "settings").notes).toEqual([
      "target.theme: `apply` changes its argument",
      SETTINGS_STATED,
    ]);
    // When the owner has no function for it, the example of one.
    expect(find(findings, "methods.ts", "registry.set").hint).toBe(
      'add a function in `mine.ts` that makes the change (e.g. `setRegistry("a", 1)`), and call it instead',
    );
  });

  it("says why it cannot follow a place, and what makes it provable", () => {
    const reasons = findings.flatMap((finding) =>
      finding.message.startsWith("not checked: ") ? [finding.hint] : [],
    );
    expect(reasons).toEqual([
      "make the change in its owner: the type of `set` is not known, so neither is what it does to `registry`",
      "import the value itself, or make the change in its owner: no import, alias, return or element leads to its declaration",
      "pass a copy, or make the change in its owner: `handlers[name]` does not resolve to a function, so whether it changes `settings` is not known",
    ]);
  });

  it("reports errors with no quick fix, whatever the severities of the guessed kinds", () => {
    const quiet: Record<string, RuleConfig> = {
      [RULE]: ["error", { severities: { direct: "off", "through-call": "off" } }],
    };
    const again = check(OWNED, quiet);
    expect(lines(again)).toEqual(lines(findings));
    expect(
      again.every(
        (finding) =>
          finding.kind === "problem" && finding.severity === "error" && finding.fixes.length === 0,
      ),
    ).toBe(true);
  });

  it("lets the files named under `owners` change it too", () => {
    const allowed = check(OWNED, {
      [RULE]: ["error", { owners: { "settings.ts": ["direct.ts"] } }],
    });
    expect(lines(allowed)).toEqual(lines(findings).filter((line) => !line.startsWith("direct.ts")));
  });

  it("gives the same findings in the same order on a second run", () => {
    expect(checkFixture(OWNED, [ownership()]).findings).toEqual(findings);
  });
});
