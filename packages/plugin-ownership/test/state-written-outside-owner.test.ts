import { describe, expect, it } from "vitest";
import { checkFixture } from "@stateward/core/testing";
import { parseConfig, type RuleConfig } from "@stateward/core";
import { ownership } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

/** The fix line of a change outside the owner: the read-only view first, `Owned` second. */
function hintFor(owner: string, example: string): string {
  return [
    "one of",
    `- add a function in \`${owner}\` that makes the change (e.g. \`${example}\`), call it, and export the value read-only (\`readonly\` at every level)`,
    `- or state it \`Owned\`, so stateward proves that only \`${owner}\` changes it`,
  ].join("\n");
}

const FLAGGED = fixture("state-written-outside-owner/flagged");
const CLEAN = fixture("state-written-outside-owner/clean");
const OWNERS = fixture("state-written-outside-owner/owners");

/** Where `reset` writes its parameter, which `settings` reaches through the callers. */
const RESET_NOTE = "target.theme: `reset` changes its argument";

/** What a finding for a change of `name`, made in `file`, says; `example` is the owner's call. */
function change(
  file: string,
  at: string,
  name: string,
  example: string,
  owner = "settings.ts",
  declared = name,
  through: string[] = [],
): Shown {
  return {
    file,
    at,
    message: `\`${name}\` is changed outside its module, \`${owner}\``,
    hint: hintFor(owner, example),
    notes: [...through, `${declared}: \`${name}\` is declared in \`${owner}\`, which owns it`],
  };
}

describe("ownership/state-written-outside-owner: changes from another module", () => {
  const findings = check(FLAGGED);

  it("reports each change at the write, with the owner's names, in file order", () => {
    expect(shown(FLAGGED, findings)).toEqual([
      change("assign.ts", "settings", "settings", "updateSettings({ fontSize: 16 })"),
      change("caller.ts", "settings", "settings", "resetSettings()", "settings.ts", "settings", [
        RESET_NOTE,
      ]),
      change("collections.ts", "items.push", "items", 'addItems("a")'),
      change("collections.ts", "registry.set", "registry", 'setRegistry("a", 1)'),
      change("collections.ts", "tags.add", "tags", 'addTags("b")'),
      change("collections.ts", 'cache["old"]', "cache", "clearOld()"),
      change("counters.ts", "counters.total", "counters", "addTotal(1)"),
      change("counters.ts", "counters.total", "counters", "incrementTotal()"),
      change("counters.ts", "state.user.name", "state", 'setName("Ada")'),
      change("let-object.ts", "current.id", "current", "setId(2)"),
      change("namespace.ts", "everything.settings.theme", "settings", 'setTheme("blue")'),
      change("nested-list.ts", 'settings.raw["key"]', "settings", 'setKey("value")'),
      change("relayed.ts", "settings", "settings", "relaySettings()", "settings.ts", "settings", [
        RESET_NOTE,
      ]),
      change("theme.ts", "settings.theme", "settings", 'setTheme("dark")'),
      change("via-index.ts", "appSettings.fontSize", "settings", "setFontSize(20)"),
    ]);
  });

  it("does not report the owner's own function, nor a class's own method", () => {
    expect(findings.some((finding) => finding.location.file.endsWith("settings.ts"))).toBe(false);
  });

  it("reports as an error, once per change, all of the rule, offering to declare the value owned", () => {
    expect(
      findings.every(
        (finding) =>
          finding.kind === "problem" &&
          finding.ruleId === "ownership/state-written-outside-owner" &&
          finding.severity === "error" &&
          finding.fixes.length === 1 &&
          finding.fixes.every((fix) => /^Declare \w+ owned by [\w./-]+\.ts$/.test(fix.title)),
      ),
    ).toBe(true);
  });

  it("gives the same findings in the same order on a second run", () => {
    const again = checkFixture(FLAGGED, [ownership()]).findings;
    expect(again).toEqual(findings);
  });

  it("reports nothing once switched off", () => {
    const { findings: off } = checkFixture(FLAGGED, [ownership()], {
      "ownership/state-written-outside-owner": "off",
    });
    expect(off).toEqual([]);
  });
});

describe("ownership/state-written-outside-owner: what stays quiet", () => {
  it("says nothing for the owner's writes, copies, reads, class methods, tests, `any`, packages and unresolved imports", () => {
    expect(check(CLEAN)).toEqual([]);
  });
});

describe("ownership/state-written-outside-owner option `owners`", () => {
  const writers = (rules: Record<string, RuleConfig> = {}): string[] =>
    shown(OWNERS, check(OWNERS, rules)).map((finding) => finding.file);

  it("reports every other file's change when nothing is allowed", () => {
    expect(writers()).toEqual(["other.ts", "slices/cart.ts", "slices/user.ts"]);
  });

  it("lets the files its globs name change the state of the declaring file", () => {
    expect(
      writers({
        "ownership/state-written-outside-owner": [
          "error",
          { owners: { "store.ts": ["slices/*.ts"] } },
        ],
      }),
    ).toEqual(["other.ts"]);
  });

  it("matches `**` across folders and takes several writer globs", () => {
    expect(
      writers({
        "ownership/state-written-outside-owner": [
          "error",
          { owners: { "*.ts": ["**/user.ts", "other.ts"] } },
        ],
      }),
    ).toEqual(["slices/cart.ts"]);
  });

  it("reports the message of the change that stays", () => {
    const findings = check(OWNERS, {
      "ownership/state-written-outside-owner": [
        "error",
        { owners: { "store.ts": ["slices/*.ts"] } },
      ],
    });
    expect(shown(OWNERS, findings)).toEqual([
      {
        file: "other.ts",
        at: "store.user.name",
        message: "`store` is changed outside its module, `store.ts`",
        hint: hintFor("store.ts", 'setName("Grace")'),
        notes: ["store: `store` is declared in `store.ts`, which owns it"],
      },
    ]);
  });

  it("rejects a bad value in the config, naming the rule and the option", () => {
    expect(
      parseConfig(
        {
          plugins: [ownership()],
          rules: { "ownership/state-written-outside-owner": ["error", { owners: ["store.ts"] }] },
        },
        OWNERS,
      ),
    ).toEqual({
      ok: false,
      errors: [
        'rules["ownership/state-written-outside-owner"].owners must be an object of names to lists of strings, got ["store.ts"]',
      ],
    });
  });
});

describe("ownership/state-written-outside-owner options `ignore` and `severities`", () => {
  const severities = (rules: Record<string, RuleConfig>): string[] =>
    check(FLAGGED, rules).map((finding) =>
      finding.kind === "problem" ? `${finding.severity} ${finding.message}` : finding.kind,
    );

  it("`ignore` leaves out the state named", () => {
    const all = severities({});
    const ignored = severities({
      "ownership/state-written-outside-owner": ["error", { ignore: ["settings"] }],
    });
    expect(ignored.length).toBeLessThan(all.length);
    expect(ignored.some((line) => line.includes("`settings` belongs"))).toBe(false);
  });

  it("`severities` sets a change through a function apart from a direct one", () => {
    const lines = severities({
      "ownership/state-written-outside-owner": [
        "error",
        { severities: { "through-call": "warning" } },
      ],
    });
    expect(lines.filter((line) => line.startsWith("warning")).length).toBeGreaterThan(0);
    expect(lines.filter((line) => line.startsWith("error")).length).toBeGreaterThan(0);
    expect(
      severities({
        "ownership/state-written-outside-owner": [
          "error",
          { severities: { direct: "off", "through-call": "off" } },
        ],
      }),
    ).toEqual([]);
  });
});
