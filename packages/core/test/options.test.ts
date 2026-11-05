import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixture } from "../src/testing.js";
import { defineConfig, definePlugin, defineRule, option, parseConfig } from "../src/internal.js";
import type { OptionsOf, RuleIdOf } from "../src/internal.js";
import { fixturePath } from "./fixture-path.js";

const dir = path.resolve("/work/project");

const specs = {
  max: option.number({
    default: 20,
    description: "Most members.",
    min: 1,
    max: 100,
    integer: true,
  }),
  ratio: option.number({ default: 0.5, description: "A ratio." }),
  strict: option.boolean({ default: false, description: "Be strict." }),
  mode: option.string({ default: "a", description: "Mode.", oneOf: ["a", "b"] }),
  label: option.string({ default: "x", description: "A label." }),
  ignore: option.strings({ default: [], description: "Names to skip." }),
  owners: option.record({ default: {}, description: "Who may write what." }),
};

const seen: OptionsOf<typeof specs>[] = [];
const withOptions = defineRule({
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "warning",
    tier: "core",
    group: "g",
    explain: "e",
    options: specs,
  },
  check(ctx) {
    const max: number = ctx.options.max;
    const mode: "a" | "b" = ctx.options.mode;
    const ignore: readonly string[] = ctx.options.ignore;
    if (ctx.file.endsWith("a.ts")) seen.push({ ...ctx.options, max, mode, ignore });
  },
});
const plain = defineRule({
  kind: "file",
  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },
  check() {
    return;
  },
});
const plugin = definePlugin({
  name: "t",
  description: "test",
  rules: { "with-options": withOptions, plain },
});

function errorsOf(rules: unknown): readonly string[] {
  const result = parseConfig({ plugins: [plugin], rules }, dir);
  return result.ok ? [] : result.errors;
}

describe("option schema in the config", () => {
  it("fills every default when the config sets nothing", () => {
    const result = parseConfig({ plugins: [plugin] }, dir);
    expect(result).toMatchObject({
      ok: true,
      value: {
        ruleOptions: {
          "t/with-options": {
            max: 20,
            ratio: 0.5,
            strict: false,
            mode: "a",
            label: "x",
            ignore: [],
            owners: {},
          },
        },
      },
    });
    expect(result.ok && "t/plain" in result.value.ruleOptions).toBe(false);
  });

  it("takes a severity with options, keeping the rest at their defaults", () => {
    const result = parseConfig(
      { plugins: [plugin], rules: { "t/with-options": ["error", { max: 5, ignore: ["a*"] }] } },
      dir,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        rules: { "t/with-options": "error" },
        ruleOptions: { "t/with-options": { max: 5, ignore: ["a*"], mode: "a" } },
      },
    });
  });

  it("takes a record of lists of strings", () => {
    const owners = { "src/store.ts": ["src/slices/*.ts"], "src/a.ts": [] };
    expect(
      parseConfig({ plugins: [plugin], rules: { "t/with-options": ["error", { owners }] } }, dir),
    ).toMatchObject({ ok: true, value: { ruleOptions: { "t/with-options": { owners } } } });
  });

  it("still takes a plain severity", () => {
    expect(errorsOf({ "t/with-options": "off", "t/plain": "info" })).toEqual([]);
  });

  it.each([
    [{ max: 0 }, 'rules["t/with-options"].max must be a whole number from 1 to 100, got 0'],
    [{ max: 2.5 }, 'rules["t/with-options"].max must be a whole number from 1 to 100, got 2.5'],
    [{ max: "5" }, 'rules["t/with-options"].max must be a whole number from 1 to 100, got "5"'],
    [{ ratio: Number.NaN }, 'rules["t/with-options"].ratio must be a number, got NaN'],
    [{ strict: "yes" }, 'rules["t/with-options"].strict must be true or false, got "yes"'],
    [{ mode: "c" }, 'rules["t/with-options"].mode must be one of "a", "b", got "c"'],
    [{ label: 3 }, 'rules["t/with-options"].label must be a string, got 3'],
    [{ ignore: 3 }, 'rules["t/with-options"].ignore must be a list of strings, got 3'],
    [{ ignore: ["a", 1] }, 'rules["t/with-options"].ignore must be a list of strings, got ["a",1]'],
    [
      { owners: ["a"] },
      'rules["t/with-options"].owners must be an object of names to lists of strings, got ["a"]',
    ],
    [
      { owners: { a: "b" } },
      'rules["t/with-options"].owners must be an object of names to lists of strings, got an object',
    ],
    [
      { owners: { a: ["b", 1] } },
      'rules["t/with-options"].owners must be an object of names to lists of strings, got an object',
    ],
    [
      { maxx: 3 },
      'rules["t/with-options"] has no option "maxx"; its options: max, ratio, strict, mode, label, ignore, owners',
    ],
  ])("rejects %j", (options, message) => {
    expect(errorsOf({ "t/with-options": ["error", options] })).toEqual([message]);
  });

  it("rejects options for a rule that declares none, naming the option", () => {
    expect(errorsOf({ "t/plain": ["error", { max: 3 }] })).toEqual([
      'rules["t/plain"] takes no options, got "max"',
    ]);
  });

  it("rejects options that are not an object, and a malformed entry", () => {
    expect(errorsOf({ "t/with-options": ["error", 3] })).toEqual([
      'rules["t/with-options"]: options must be an object of option names to values, got 3',
    ]);
    expect(errorsOf({ "t/with-options": ["loud", {}] })).toEqual([
      'rules["t/with-options"] must be "error", "warning", "info", "off", or [severity, { options }]',
    ]);
  });

  it("reports every bad option, not just the first", () => {
    expect(errorsOf({ "t/with-options": ["error", { max: 0, mode: "c" }] })).toHaveLength(2);
  });

  it("rejects a declared default that does not fit its own spec", () => {
    const bad = definePlugin({
      name: "bad",
      description: "bad",
      rules: {
        r: defineRule({
          kind: "file",
          meta: {
            description: "d",
            defaultSeverity: "warning",
            tier: "core",
            group: "g",
            explain: "e",
            options: { n: option.number({ default: 0, description: "N.", min: 1 }) },
          },
          check() {
            return;
          },
        }),
      },
    });
    expect(parseConfig({ plugins: [bad] }, dir)).toEqual({
      ok: false,
      errors: [
        'plugin "bad": rule "r".meta.options.n.default must be a number of at least 1, got 0',
      ],
    });
  });
});

describe("options reach the rule", () => {
  it("gives a file rule its typed, defaulted values", () => {
    seen.length = 0;
    checkFixture(fixturePath("options"), [plugin], {
      "t/with-options": ["warning", { max: 7, mode: "b" }],
    });
    expect(seen).toEqual([
      { max: 7, ratio: 0.5, strict: false, mode: "b", label: "x", ignore: [], owners: {} },
    ]);
  });

  it("gives the defaults when the rule is not configured", () => {
    seen.length = 0;
    checkFixture(fixturePath("options"), [plugin]);
    expect(seen[0]?.max).toBe(20);
  });
});

describe("defineConfig", () => {
  it("accepts the rule ids of its plugins, with or without options", () => {
    const config = defineConfig({
      plugins: [plugin],
      rules: { "t/with-options": ["error", { max: 3 }], "t/plain": "off" },
    });
    expect(config.rules?.["t/plain"]).toBe("off");
    const ids = ["t/with-options", "t/plain"] as const satisfies readonly RuleIdOf<typeof plugin>[];
    expect(ids).toHaveLength(2);
  });
});
