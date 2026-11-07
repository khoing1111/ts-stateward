import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineConfig, parseConfig } from "../src/internal.js";
import type { Plugin } from "../src/internal.js";
import { callProbe, plugin } from "./probe-plugin.js";

const probe = plugin({ calls: callProbe });
const dir = path.resolve("/work/project");

describe("defineConfig", () => {
  it("returns its input", () => {
    const config = { plugins: [probe] };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("parseConfig: preset and addons", () => {
  const withAddon: Plugin = {
    ...probe,
    rules: {
      r: { ...callProbe, meta: { ...callProbe.meta, tier: "addon", addon: "extra-checks" } },
    },
  };

  it("keeps the preset and the add-ons the user set", () => {
    const result = parseConfig(
      { plugins: [withAddon], preset: "strict", addons: ["probe/extra-checks"] },
      dir,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { preset: "strict", addons: ["probe/extra-checks"] },
    });
  });

  it("rejects an unknown preset, naming it", () => {
    const result = parseConfig({ plugins: [probe], preset: "loud" }, dir);
    expect(result).toEqual({ ok: false, errors: ['preset must be "recommended" or "strict"'] });
  });

  it("rejects an add-on that no loaded plugin offers, naming the entry and what is offered", () => {
    const result = parseConfig(
      { plugins: [withAddon], addons: ["probe/extra-checks", "probe/nope", "other/extra-checks"] },
      dir,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'addons: unknown add-on "probe/nope"; add-ons of the loaded plugins: probe/extra-checks',
        'addons: unknown add-on "other/extra-checks"; add-ons of the loaded plugins: probe/extra-checks',
      ],
    });
  });

  it("says when no loaded plugin offers any add-on, and rejects a non-list", () => {
    expect(parseConfig({ plugins: [probe], addons: ["probe/x"] }, dir)).toEqual({
      ok: false,
      errors: ['addons: unknown add-on "probe/x"; add-ons of the loaded plugins: none'],
    });
    expect(parseConfig({ plugins: [probe], addons: "x" }, dir)).toEqual({
      ok: false,
      errors: ["addons must be an array of strings"],
    });
  });
});

describe("parseConfig", () => {
  it("fills in the defaults and resolves the tsconfig against the config dir", () => {
    const result = parseConfig({ plugins: [probe] }, dir);
    expect(result).toEqual({
      ok: true,
      value: {
        tsconfig: [path.join(dir, "tsconfig.json")],
        tsconfigAsWritten: ["tsconfig.json"],
        include: ["**/*.ts", "**/*.tsx"],
        exclude: [
          "**/*.test.*",
          "**/*.spec.*",
          "**/__tests__/**",
          "**/__scenarios__/**",
          "**/__fixtures__/**",
          "**/__mocks__/**",
          "**/*.testing.*",
          "**/*.stories.*",
          "**/*.story.*",
          "**/node_modules/**",
        ],
        replacesDefaultExclude: false,
        plugins: [probe],
        preset: undefined,
        addons: [],
        rules: {},
        groups: {},
        ruleOptions: {},
        rollout: false,
        configDir: dir,
        facts: {},
        overrides: [],
        ignores: { requireReason: true, reportUnused: "warning" },
        warnings: [],
        unknowns: "info",
      },
    });
  });

  it("keeps what the user set", () => {
    const result = parseConfig(
      {
        tsconfig: "tsconfig.app.json",
        include: ["src/**"],
        exclude: [],
        plugins: [probe],
        rules: { "probe/calls": "off" },
      },
      dir,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        tsconfig: [path.join(dir, "tsconfig.app.json")],
        include: ["src/**"],
        exclude: [],
        rules: { "probe/calls": "off" },
      },
    });
  });

  it("keeps facts about packages, and names each malformed one", () => {
    const facts = { axios: { get: { throws: ["AxiosError"] }, post: { rejects: [] } } };
    expect(parseConfig({ plugins: [probe], facts }, dir)).toMatchObject({
      ok: true,
      value: { facts },
    });
    const result = parseConfig(
      {
        plugins: [probe],
        facts: { a: [], b: { f: { throws: "X" }, g: { returns: ["Y"] }, h: 1 } },
      },
      dir,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'facts["a"] must be an object of functions',
        'facts["b"]["f"].throws must be an array of class names',
        'facts["b"]["g"]: unknown fact "returns"; facts are "throws" or "rejects"',
        'facts["b"]["h"] must be an object: { throws: [...], rejects: [...] }',
      ],
    });
  });

  it("rejects input that is not an object", () => {
    expect(parseConfig(null, dir)).toEqual({ ok: false, errors: ["config must be an object"] });
    expect(parseConfig([], dir)).toEqual({ ok: false, errors: ["config must be an object"] });
  });

  it("rejects unknown keys, bad types and a missing plugins list, naming each", () => {
    const result = parseConfig({ tsconfig: 3, include: "src", extra: true }, dir);
    expect(result).toEqual({
      ok: false,
      errors: [
        'unknown config key "extra"',
        'tsconfig must be a path or a list of paths and globs, like "tsconfig.json" or ["packages/*/tsconfig.json"]',
        "plugins must be an array",
        "include must be an array of strings",
      ],
    });
  });

  it("rejects unknown rule ids and bad settings", () => {
    const result = parseConfig(
      { plugins: [probe], rules: { "probe/nope": "error", "probe/calls": "loud" } },
      dir,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'rules: unknown rule id "probe/nope"',
        'rules["probe/calls"] must be "error", "warning", "info", "off", or [severity, { options }]',
      ],
    });
  });

  it("keeps the groups the user set, and none by default", () => {
    expect(parseConfig({ plugins: [probe] }, dir)).toMatchObject({
      ok: true,
      value: { groups: {} },
    });
    expect(
      parseConfig({ plugins: [probe], groups: { "probe/probes": "warning" } }, dir),
    ).toMatchObject({ ok: true, value: { groups: { "probe/probes": "warning" } } });
  });

  it("rejects an unknown group, naming the groups of that plugin", () => {
    const result = parseConfig({ plugins: [probe], groups: { "probe/nope": "error" } }, dir);
    expect(result).toEqual({
      ok: false,
      errors: ['groups: unknown group "probe/nope"; groups of probe: probes'],
    });
  });

  it("rejects a group of a plugin that is not loaded, and a bad setting or shape", () => {
    expect(parseConfig({ plugins: [probe], groups: { "other/x": "error" } }, dir)).toEqual({
      ok: false,
      errors: ['groups: unknown group "other/x": no loaded plugin matches; plugins: probe'],
    });
    expect(parseConfig({ plugins: [probe], groups: { "probe/probes": "loud" } }, dir)).toEqual({
      ok: false,
      errors: ['groups["probe/probes"] must be "error", "warning", "info" or "off"'],
    });
    expect(
      parseConfig({ plugins: [probe], groups: { "probe/probes": ["error", {}] } }, dir),
    ).toMatchObject({ ok: false });
    expect(parseConfig({ plugins: [probe], groups: [] }, dir)).toEqual({
      ok: false,
      errors: ["groups must be an object"],
    });
  });

  it("rejects duplicate plugin names", () => {
    const result = parseConfig({ plugins: [probe, probe] }, dir);
    expect(result).toEqual({ ok: false, errors: ['duplicate plugin name "probe"'] });
  });

  it("rejects malformed plugins", () => {
    const result = parseConfig(
      {
        plugins: [
          "nope",
          { name: "a/b", rules: {} },
          { name: "w", rules: {} },
          {
            name: "x",
            description: "d",
            rules: { r: { kind: "file", meta: { description: "d" } } },
          },
          {
            name: "y",
            description: "d",
            rules: { r: { kind: "project", meta: probe.rules.calls?.meta } },
          },
          { name: "z", description: "d", rules: {}, editor: { hover: 1 } },
        ],
      },
      dir,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        "plugins[0] must be an object",
        'plugins[1].name must be a non-empty string without "/"',
        'plugin "w": description must be a non-empty string',
        'plugin "x": rule "r".meta.explain must be a string',
        'plugin "y": rule "r" must be a "file" rule with check(), a "project" rule with summarize() and check(), or a "lazy" rule with load()',
        'plugin "z".editor.hover must be a function',
      ],
    });
  });

  it.each([
    [{ tier: undefined }, '.meta.tier must be "core", "coverage" or "addon"'],
    [{ tier: "extra" }, '.meta.tier must be "core", "coverage" or "addon"'],
    [{ group: undefined }, ".meta.group must name the rule's group in kebab-case"],
    [{ group: "" }, ".meta.group must name the rule's group in kebab-case"],
    [{ group: "Not Kebab" }, ".meta.group must name the rule's group in kebab-case"],
    [{ group: 3 }, ".meta.group must name the rule's group in kebab-case"],
    [{ tier: "addon" }, '.meta.addon must name the add-on in kebab-case when tier is "addon"'],
    [{ tier: "addon", addon: "Not Kebab" }, ".meta.addon must name the add-on in kebab-case"],
    [{ tier: "core", addon: "x" }, '.meta.addon is only for tier "addon", not "core"'],
    [{ tier: "core", heuristic: false }, ".meta.heuristic must be true when present"],
    [{ summary: 3 }, ".meta.summary must be a string when present"],
  ])("rejects rule meta %j", (change, error) => {
    const rule = { ...probe.rules.calls, meta: { ...probe.rules.calls?.meta, ...change } };
    const result = parseConfig({ plugins: [{ ...probe, rules: { r: rule } }] }, dir);
    expect(result).toEqual({
      ok: false,
      errors: [expect.stringContaining(error)],
    });
  });

  it("accepts add-on and heuristic meta", () => {
    const meta = {
      ...probe.rules.calls?.meta,
      tier: "addon",
      addon: "sinks-and-registries",
      heuristic: true,
    };
    const rule = { ...probe.rules.calls, meta };
    const result = parseConfig({ plugins: [{ ...probe, rules: { r: rule } }] }, dir);
    expect(result.ok && result.value.plugins[0]?.rules.r?.meta).toEqual(meta);
  });

  it("keeps a rule's summary", () => {
    const meta = { ...probe.rules.calls?.meta, summary: "a call the probe finds" };
    const rule = { ...probe.rules.calls, meta };
    const result = parseConfig({ plugins: [{ ...probe, rules: { r: rule } }] }, dir);
    expect(result.ok && result.value.plugins[0]?.rules.r?.meta).toEqual(meta);
  });

  it("accepts widenedBy on a core rule and offers it as an add-on", () => {
    const meta = { ...probe.rules.calls?.meta, tier: "core", widenedBy: ["wide"] };
    const rule = { ...probe.rules.calls, meta };
    const result = parseConfig(
      { plugins: [{ ...probe, rules: { r: rule } }], addons: ["probe/wide"] },
      dir,
    );
    expect(result.ok && result.value.addons).toEqual(["probe/wide"]);
  });

  it.each([
    [{ tier: "core", widenedBy: "wide" }, ".meta.widenedBy must be a list of add-on names"],
    [{ tier: "core", widenedBy: ["Not Kebab"] }, ".meta.widenedBy must be a list of add-on names"],
    [{ tier: "addon", addon: "x", widenedBy: ["y"] }, '.meta.widenedBy is only for tiers "core"'],
  ])("rejects rule meta %j", (change, error) => {
    const rule = { ...probe.rules.calls, meta: { ...probe.rules.calls?.meta, ...change } };
    const result = parseConfig({ plugins: [{ ...probe, rules: { r: rule } }] }, dir);
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining(error)] });
  });

  it("keeps a plugin's editor contributions", () => {
    const withEditor: Plugin = { ...probe, editor: { hover: () => "doc" } };
    const result = parseConfig({ plugins: [withEditor] }, dir);
    expect(result.ok && Object.keys(result.value.plugins[0]?.editor ?? {})).toEqual(["hover"]);
  });
});
