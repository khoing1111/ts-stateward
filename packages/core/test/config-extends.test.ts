import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaults,
  matchingOverrides,
  option,
  parseConfig,
  ruleIsOn,
  ruleSetting,
} from "../src/internal.js";
import type { Config, FileRule, Plugin, RuleInfo, RuleMeta } from "../src/internal.js";

const dir = path.resolve("/work/app");

const meta = (change: Partial<RuleMeta> = {}): RuleMeta => ({
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "e",
  ...change,
});

function fileRule(change: Partial<RuleMeta> = {}, name = "run"): FileRule {
  return {
    kind: "file",
    meta: meta(change),
    check() {
      return name;
    },
  };
}

const guards: Plugin = {
  name: "guards",
  description: "guards",
  rules: {
    lookup: fileRule({ group: "switches" }),
    cover: fileRule({ tier: "coverage", defaultSeverity: "warning", group: "switches" }),
    wide: fileRule({ tier: "addon", addon: "wide", group: "extra" }),
    wider: fileRule({ tier: "addon", addon: "wider", group: "extra" }),
  },
};
const states: Plugin = {
  name: "states",
  description: "states",
  rules: { fixed: fileRule({ group: "records" }) },
};

function parsed(input: unknown): Config {
  const result = parseConfig(input, dir);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
}

function errorsOf(input: unknown): readonly string[] {
  const result = parseConfig(input, dir);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

describe("extends", () => {
  it("merges in order and lets the file that extends win", () => {
    const team = {
      plugins: [guards],
      preset: "strict",
      tsconfig: "tsconfig.team.json",
      rules: { "guards/lookup": "warning", "guards/cover": "off" },
      groups: { "guards/switches": "info" },
      addons: ["guards/wide"],
      rollout: true,
    };
    const second = {
      rules: { "guards/lookup": "info" },
      addons: ["guards/wide", "guards/wider"],
      tsconfig: "tsconfig.second.json",
    };
    const config = parsed({
      extends: [team, second],
      plugins: [states],
      tsconfig: "tsconfig.json",
      rules: { "states/fixed": "warning", "guards/cover": "error" },
      addons: ["guards/wide"],
    });
    expect(config.plugins.map((plugin) => plugin.name)).toEqual(["guards", "states"]);
    // Per key: the later config's rule wins, the other keys stay.
    expect(config.rules).toEqual({
      "guards/lookup": "info",
      "guards/cover": "error",
      "states/fixed": "warning",
    });
    expect(config.groups).toEqual({ "guards/switches": "info" });
    expect(config.addons).toEqual(["guards/wide", "guards/wider"]);
    // A scalar: the last config that sets it; the extending file's tsconfig comes last.
    expect(config.tsconfig).toEqual([path.join(dir, "tsconfig.json")]);
    expect(config.preset).toBe("strict");
    expect(config.rollout).toBe(true);
  });

  it("keeps a rule's options when a later config sets only its severity, and replaces them whole otherwise", () => {
    const options = {
      maxHidden: option.number({ default: 5, description: "Most hidden." }),
      label: option.string({ default: "x", description: "A label." }),
    };
    const tuned: Plugin = {
      name: "tuned",
      description: "tuned",
      rules: { rule: fileRule({ options }) },
    };
    const team = { plugins: [tuned], rules: { "tuned/rule": ["error", { maxHidden: 10 }] } };
    const severity = parsed({ extends: [team], rules: { "tuned/rule": "warning" } });
    expect(severity.rules).toEqual({ "tuned/rule": "warning" });
    expect(severity.ruleOptions["tuned/rule"]).toEqual({ maxHidden: 10, label: "x" });
    const replaced = parsed({
      extends: [{ ...team, rules: { "tuned/rule": ["error", { maxHidden: 10, label: "y" }] } }],
      rules: { "tuned/rule": ["warning", { label: "z" }] },
    });
    expect(replaced.ruleOptions["tuned/rule"]).toEqual({ maxHidden: 5, label: "z" });
    // An override sets a severity only; the options of the rule stay the merged ones.
    const overridden = parsed({
      extends: [team],
      overrides: [{ files: ["src/legacy/**"], rules: { "tuned/rule": "info" } }],
    });
    expect(ruleSetting(overridden, "tuned", "rule", meta(), "/work/app/src/legacy/a.ts")).toBe(
      "info",
    );
    expect(overridden.ruleOptions["tuned/rule"]).toEqual({ maxHidden: 10, label: "x" });
  });

  it("takes a scalar from the last extended config when this file does not set it", () => {
    const config = parsed({
      extends: [{ preset: "strict", exclude: ["a/**"] }, { preset: "recommended" }],
      plugins: [guards],
    });
    expect([config.preset, config.exclude]).toEqual(["recommended", ["a/**"]]);
  });

  it("joins add-ons of all configs and lists them once", () => {
    const config = parsed({
      extends: [{ plugins: [guards], addons: ["guards/wide"] }],
      addons: ["guards/wide"],
    });
    expect(config.addons).toEqual(["guards/wide"]);
  });

  it("merges the facts of every config per package and function", () => {
    const config = parsed({
      extends: [
        {
          plugins: [],
          facts: { axios: { get: { throws: ["A"] }, post: { throws: ["B"] } } },
        },
      ],
      facts: { axios: { get: { throws: ["C"] } }, ky: { get: { rejects: ["D"] } } },
    });
    expect(config.facts).toEqual({
      axios: { get: { throws: ["C"] }, post: { throws: ["B"] } },
      ky: { get: { rejects: ["D"] } },
    });
  });

  it("works through nested extends, the deepest config first", () => {
    const base = { plugins: [guards], rules: { "guards/lookup": "off" }, preset: "strict" };
    const team = { extends: [base], rules: { "guards/lookup": "warning" } };
    const config = parsed({ extends: [team], rules: { "guards/cover": "off" } });
    expect(config.rules).toEqual({ "guards/lookup": "warning", "guards/cover": "off" });
    expect(config.preset).toBe("strict");
  });

  it("does not need a plugins list when an extended config brings the plugins", () => {
    expect(parsed({ extends: [{ plugins: [guards] }] }).plugins).toEqual([guards]);
    expect(errorsOf({ extends: [{}] })).toEqual(["plugins must be an array"]);
  });

  it("checks a rule of an extended config against the merged plugins", () => {
    const team = { rules: { "states/fixed": "warning" } };
    expect(parsed({ extends: [team], plugins: [states] }).rules).toEqual({
      "states/fixed": "warning",
    });
    expect(errorsOf({ extends: [team], plugins: [guards] })).toEqual([
      'rules: unknown rule id "states/fixed"',
    ]);
  });

  it("reports an extends that reaches itself instead of looping", () => {
    const loop: Record<string, unknown> = { plugins: [guards] };
    loop.extends = [loop];
    expect(errorsOf(loop)).toEqual([
      "extends[0] extends a config that extends it back; remove one of the two",
    ]);
  });

  it("names the extended config a mistake is in", () => {
    expect(errorsOf({ plugins: [guards], extends: [{ colour: 1 }] })).toEqual([
      'extends[0]: unknown config key "colour"',
    ]);
    expect(errorsOf({ plugins: [guards], extends: "team" })).toEqual([
      "extends must be a list of shared configs, like extends: [team]",
    ]);
    expect(errorsOf({ plugins: [guards], extends: [42] })).toEqual([
      "extends[0] must be a config: what a shared config package exports with defineConfig({ ... })",
    ]);
    expect(errorsOf({ plugins: [guards], extends: [{ rules: [] }] })).toEqual([
      "extends[0]: rules must be an object",
    ]);
  });
});

describe("joining plugins by name", () => {
  it("keeps one plugin when two configs hold the very same one", () => {
    const config = parsed({ extends: [{ plugins: [guards, states] }], plugins: [guards] });
    expect(config.plugins).toEqual([guards, states]);
  });

  it("lets the later instance win when it is the same package loaded twice", () => {
    const copy: Plugin = { ...guards, description: "the copy", rules: { ...guards.rules } };
    const config = parsed({ extends: [{ plugins: [guards] }], plugins: [copy] });
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]?.description).toBe("the copy");
  });

  it("is an error when two different packages use one plugin name", () => {
    const other: Plugin = {
      name: "guards",
      description: "another package",
      rules: { different: fileRule() },
    };
    expect(errorsOf({ extends: [{ plugins: [guards] }], plugins: [other] })).toEqual([
      'plugin "guards" comes from two different packages (extends[0] and your config); keep one of them',
    ]);
  });

  it("still reports a name used twice in one list", () => {
    expect(errorsOf({ plugins: [guards, guards] })).toEqual(['duplicate plugin name "guards"']);
  });
});

describe("defaults", () => {
  it("exports the lists a config without include and exclude gets", () => {
    const config = parsed({ plugins: [guards] });
    expect(config.include).toEqual(defaults.include);
    expect(config.exclude).toEqual(defaults.exclude);
    expect(defaults.exclude).toContain("**/*.test.*");
    expect(defaults.exclude).toContain("**/*.stories.*");
  });

  it("adds to the default excludes when they are spread", () => {
    const config = parsed({
      plugins: [guards],
      exclude: [...defaults.exclude, "src/generated/**"],
    });
    expect(config.exclude.at(-1)).toBe("src/generated/**");
    expect(config.replacesDefaultExclude).toBe(false);
  });

  it("notices an exclude that drops the default entries", () => {
    expect(
      parsed({ plugins: [guards], exclude: ["src/generated/**"] }).replacesDefaultExclude,
    ).toBe(true);
    expect(parsed({ plugins: [guards] }).replacesDefaultExclude).toBe(false);
  });
});

describe("overrides", () => {
  it("is validated with the place of each mistake", () => {
    const base = { plugins: [guards] };
    expect(errorsOf({ ...base, overrides: "x" })).toEqual([
      "overrides must be an array of { files: [...], rules: {...} }",
    ]);
    expect(errorsOf({ ...base, overrides: [3] })).toEqual([
      'overrides[0] must be an object: { files: ["src/legacy/**"], rules: { ... } }',
    ]);
    expect(errorsOf({ ...base, overrides: [{ files: ["a"], rule: {} }] })).toEqual([
      'overrides[0]: unknown key "rule"; an override takes "files", "rules", "groups", "preset" or "addons"',
    ]);
    expect(errorsOf({ ...base, overrides: [{ rules: {} }] })).toEqual([
      'overrides[0].files must be a list of globs, like ["src/legacy/**"]',
    ]);
    expect(errorsOf({ ...base, overrides: [{ files: ["a", 7] }] })).toEqual([
      'overrides[0].files[1] must be a string glob like "src/legacy/**", not 7',
    ]);
    expect(errorsOf({ ...base, overrides: [{ files: ["a"], preset: "loud" }] })).toEqual([
      'overrides[0].preset must be "recommended" or "strict"',
    ]);
  });

  it("checks rule, group and add-on names against the plugins", () => {
    const files = ["src/**"];
    const base = { plugins: [guards] };
    expect(errorsOf({ ...base, overrides: [{ files, rules: { "guards/nope": "off" } }] })).toEqual([
      'overrides[0].rules: unknown rule id "guards/nope"',
    ]);
    expect(
      errorsOf({ ...base, overrides: [{ files, rules: { "guards/lookup": "loud" } }] }),
    ).toEqual(['overrides[0].rules["guards/lookup"] must be "error", "warning", "info" or "off"']);
    expect(
      errorsOf({ ...base, overrides: [{ files, groups: { "guards/missing": "off" } }] })[0],
    ).toContain('overrides[0].groups: unknown group "guards/missing"');
    expect(errorsOf({ ...base, overrides: [{ files, addons: ["guards/huge"] }] })[0]).toContain(
      'overrides[0].addons: unknown add-on "guards/huge"',
    );
  });

  it("takes a severity only: a rule's options are set once", () => {
    expect(
      errorsOf({
        plugins: [guards],
        overrides: [{ files: ["a"], rules: { "guards/lookup": ["off", {}] } }],
      }),
    ).toEqual([
      `overrides[0].rules["guards/lookup"] takes a severity or "off", not options; set a rule's options once, in the config's own rules`,
    ]);
  });

  it("joins the overrides of extended configs before this file's own", () => {
    const config = parsed({
      plugins: [guards],
      extends: [{ overrides: [{ files: ["a/**"], rules: { "guards/lookup": "off" } }] }],
      overrides: [{ files: ["b/**"], preset: "strict" }],
    });
    expect(config.overrides.map((one) => one.files)).toEqual([["a/**"], ["b/**"]]);
    expect(config.overrides[1]?.preset).toBe("strict");
    expect(config.overrides[0]?.preset).toBeUndefined();
  });

  it("matches the globs against the path relative to the config's folder, later entries last", () => {
    const config = parsed({
      plugins: [guards],
      overrides: [
        { files: ["src/legacy/**"], rules: { "guards/lookup": "off" } },
        { files: ["src/**/*.tsx", "lib/*.ts"], rules: { "guards/lookup": "info" } },
      ],
    });
    const at = (relative: string): readonly number[] =>
      matchingOverrides(config, path.join(dir, relative));
    expect(at("src/legacy/a.tsx")).toEqual([0, 1]);
    expect(at("src/new/a.ts")).toEqual([]);
    expect(at("lib/a.ts")).toEqual([1]);
    expect(at("other/src/legacy/a.ts")).toEqual([]);
  });
});

describe("the setting of a rule in a file", () => {
  const config = parsed({
    preset: "recommended",
    plugins: [guards, states],
    rules: { "guards/lookup": "warning" },
    overrides: [
      { files: ["src/legacy/**"], rules: { "guards/lookup": "off" } },
      { files: ["src/payments/**"], preset: "strict", addons: ["guards/wide"] },
      { files: ["src/payments/old/**"], groups: { "guards/switches": "info" } },
      {
        files: ["src/tests/**"],
        groups: { "guards/switches": "off" },
        rules: { "guards/cover": "error" },
      },
    ],
  });
  const here = (relative: string): string => path.join(dir, relative);
  const lookup = guards.rules.lookup?.meta ?? meta();
  const cover = guards.rules.cover?.meta ?? meta();
  const wide = guards.rules.wide?.meta ?? meta();
  const at = (key: string, ruleMeta: RuleInfo, relative: string) =>
    ruleSetting(config, "guards", key, ruleMeta, here(relative));

  it("is the config's own setting without a file, and in a file no override reaches", () => {
    expect(ruleSetting(config, "guards", "lookup", lookup)).toBe("warning");
    expect(at("lookup", lookup, "src/app/a.ts")).toBe("warning");
    expect(at("cover", cover, "src/app/a.ts")).toBe("info");
    expect(at("wide", wide, "src/app/a.ts")).toBe("off");
  });

  it("lets an override turn a rule off in a folder", () => {
    expect(at("lookup", lookup, "src/legacy/a.ts")).toBe("off");
    expect(at("cover", cover, "src/legacy/a.ts")).toBe("info");
  });

  it("applies an override's preset and add-ons to what the config left to the defaults", () => {
    expect(at("cover", cover, "src/payments/a.ts")).toBe("error");
    expect(at("wide", wide, "src/payments/a.ts")).toBe("error");
    // The config's own explicit setting still stands: a preset only changes defaults.
    expect(at("lookup", lookup, "src/payments/a.ts")).toBe("warning");
  });

  it("applies the matching overrides in order, each by preset, add-ons, groups, then rules", () => {
    // Payments' strict preset, then the later group entry wins for the group's rules.
    expect(at("cover", cover, "src/payments/old/a.ts")).toBe("info");
    expect(at("lookup", lookup, "src/payments/old/a.ts")).toBe("info");
    // A rule named in an entry wins over the group in the same entry.
    expect(at("cover", cover, "src/tests/a.ts")).toBe("error");
    expect(at("lookup", lookup, "src/tests/a.ts")).toBe("off");
  });

  it("says a rule is on when it is on in the config or in some override", () => {
    const onlyHere = parsed({
      plugins: [guards],
      rules: { "guards/lookup": "off" },
      overrides: [{ files: ["src/payments/**"], rules: { "guards/lookup": "error" } }],
    });
    expect(ruleIsOn(onlyHere, "guards", "lookup", lookup)).toBe(true);
    expect(ruleSetting(onlyHere, "guards", "lookup", lookup)).toBe("off");
    const nowhere = parsed({ plugins: [guards], rules: { "guards/lookup": "off" } });
    expect(ruleIsOn(nowhere, "guards", "lookup", lookup)).toBe(false);
  });
});

describe("ignores", () => {
  it("defaults to a required reason and a warning for an unneeded ignore", () => {
    expect(parsed({ plugins: [] }).ignores).toEqual({
      requireReason: true,
      reportUnused: "warning",
    });
  });

  it("takes both options, and one from each of two configs", () => {
    const config = parsed({
      extends: [{ ignores: { requireReason: false } }],
      plugins: [],
      ignores: { reportUnused: "off" },
    });
    expect(config.ignores).toEqual({ requireReason: false, reportUnused: "off" });
  });

  it("explains a wrong option", () => {
    expect(errorsOf({ plugins: [], ignores: 1 })).toEqual([
      'ignores must be an object: { requireReason: true, reportUnused: "warning" }',
    ]);
    expect(errorsOf({ plugins: [], ignores: { requireReasons: true } })).toEqual([
      'ignores: unknown key "requireReasons"; ignores takes "requireReason" or "reportUnused"',
    ]);
    expect(
      errorsOf({ plugins: [], ignores: { requireReason: "yes", reportUnused: "info" } }),
    ).toEqual([
      "ignores.requireReason must be true or false",
      'ignores.reportUnused must be "error", "warning" or "off"',
    ]);
  });
});
