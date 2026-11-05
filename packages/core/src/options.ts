import picomatch from "picomatch";
import type {
  BooleanOption,
  NumberOption,
  OptionSpec,
  OptionSpecs,
  NoOptions,
  Options,
  OptionsOf,
  OptionValue,
  Plugin,
  PluginRule,
  RuleConfig,
  GroupIdOf,
  RuleIdOf,
  RuleSetting,
  StringOption,
  StringsOption,
  RecordOption,
  SeveritiesOption,
  SeverityMap,
  StringListRecord,
} from "./types.js";

/*
 * Types for the options in `stateward.config.ts`. This is the one place with conditional types:
 * `defineConfig` has to turn each plugin's rules (their `meta.options`, kept as literal types by
 * `defineRule` and `definePlugin`) into the type of `rules: { "<plugin>/<rule>": [severity, {…}] }`.
 * Test: packages/core/test/config-types.test.ts.
 */

/** The option specs a rule type declares; a wide `Rule` declares "some", a `NoOptions` rule none. */
type SpecsOf<R extends PluginRule> = NonNullable<R["meta"]["options"]>;

/**
 * The options a config may set on rule type `R`: each declared name, optional, with its value type
 * (the union of `oneOf` for a string option). A rule that declares none takes no names at all; a
 * rule typed as the wide `Rule` takes any name, because nothing says which exist.
 */
export type ConfigOptionsOf<R extends PluginRule> =
  SpecsOf<R> extends NoOptions ? NoOptions : Partial<OptionsOf<SpecsOf<R>>>;

/** The rule of `P` (a plugin, or a union of plugins) whose id is `Id`. */
type RuleById<P extends Plugin, Id extends string> = P extends Plugin
  ? Id extends `${P["name"]}/${infer Key}`
    ? Key extends keyof P["rules"]
      ? P["rules"][Key] extends infer R extends PluginRule
        ? R
        : never
      : never
    : never
  : never;

/** The `rules` of a config for plugin type `P`: its rule ids as keys, each with its own options. */
export type RuleConfigsOf<P extends Plugin> = {
  readonly [Id in RuleIdOf<P>]?: RuleConfig<ConfigOptionsOf<RuleById<P, Id>>>;
};

/** The `groups` of a config for plugin type `P`: its group ids as keys, each a severity or "off". */
export type GroupConfigsOf<P extends Plugin> = Readonly<Partial<Record<GroupIdOf<P>, RuleSetting>>>;

/**
 * Builders for the options a rule declares in `meta.options`. Each one is the single place that
 * says an option's type, default and description; the typed `ctx.options`, the config check and
 * the generated docs all come from it.
 */
/** With `oneOf`, the option's type is the union of those strings. */
function optionString<const T extends string>(input: {
  default: T;
  description: string;
  oneOf: readonly T[];
}): StringOption<T>;
function optionString(input: { default: string; description: string }): StringOption;
function optionString(input: {
  default: string;
  description: string;
  oneOf?: readonly string[];
}): StringOption {
  return { kind: "string", ...input };
}

export const option = {
  boolean(input: { default: boolean; description: string }): BooleanOption {
    return { kind: "boolean", ...input };
  },
  number(input: {
    default: number;
    description: string;
    min?: number;
    max?: number;
    integer?: boolean;
  }): NumberOption {
    return { kind: "number", ...input };
  },
  string: optionString,
  /** A list of strings. */
  strings(input: { default: readonly string[]; description: string }): StringsOption {
    return { kind: "strings", ...input };
  },
  /** An object of names to lists of strings. */
  record(input: { default: StringListRecord; description: string }): RecordOption {
    return { kind: "record", ...input };
  },
  /**
   * A severity per kind of finding (`{ kind: "warning" }`), for a rule whose kinds differ in how
   * sure it is. Each kind is named with what it is; a kind the config leaves out keeps the rule's
   * severity.
   */
  severities<const K extends string>(input: {
    kinds: Readonly<Record<K, string>>;
    description: string;
  }): SeveritiesOption<K> {
    return { kind: "severities", default: {}, ...input };
  },
};

const SETTINGS: readonly string[] = ["error", "warning", "info", "off"];

function isSeverityMap(value: unknown, kinds: readonly string[]): value is SeverityMap {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([kind, setting]: [string, unknown]) =>
        kinds.includes(kind) && typeof setting === "string" && SETTINGS.includes(setting),
    )
  );
}

/**
 * Whether `file` (absolute) matches one of `globs` written from the project's folder
 * (`src/codecs/**`). The project's folder is not known to a rule, so a glob matches when it
 * matches the whole path or any part of it that starts after a `/`.
 */
export function matchesFile(file: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  const matcher = picomatch([...globs], { dot: true });
  const parts = file.replaceAll("\\", "/").split("/");
  return parts.some((_, index) => matcher(parts.slice(index).join("/")));
}

/**
 * Whether `name` matches one of `globs`, where `*` stands for any run of characters and every
 * other character is itself (`*_MESSAGES`, `use*Query`). The options that list names use it.
 */
export function matchesName(name: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    const parts = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${parts.join(".*")}$`).test(name);
  });
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isStringListRecord(value: unknown): value is StringListRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringList)
  );
}

/** How a value reads in an error message: JSON for data, a word for the rest. */
function describeGiven(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (typeof value === "string" || Array.isArray(value)) return JSON.stringify(value);
  return typeof value === "object" ? "an object" : typeof value;
}

function numberExpectation(spec: NumberOption): string {
  const what = spec.integer === true ? "a whole number" : "a number";
  const { min, max } = spec;
  if (min !== undefined && max !== undefined)
    return `${what} from ${String(min)} to ${String(max)}`;
  if (min !== undefined) return `${what} of at least ${String(min)}`;
  if (max !== undefined) return `${what} of at most ${String(max)}`;
  return what;
}

/** What the option accepts, as the end of "must be …". */
export function expectation(spec: OptionSpec): string {
  switch (spec.kind) {
    case "boolean":
      return "true or false";
    case "number":
      return numberExpectation(spec);
    case "string":
      return spec.oneOf === undefined
        ? "a string"
        : `one of ${spec.oneOf.map((value) => JSON.stringify(value)).join(", ")}`;
    case "strings":
      return "a list of strings";
    case "record":
      return "an object of names to lists of strings";
    case "severities":
      return `an object of ${Object.keys(spec.kinds)
        .map((kind) => JSON.stringify(kind))
        .join(", ")} to "error", "warning", "info" or "off"`;
    default: {
      const unreachable: never = spec;
      return unreachable;
    }
  }
}

function accepts(spec: OptionSpec, value: unknown): value is OptionValue {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (spec.integer !== true || Number.isInteger(value)) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
    case "string":
      return typeof value === "string" && (spec.oneOf === undefined || spec.oneOf.includes(value));
    case "strings":
      return isStringList(value);
    case "record":
      return isStringListRecord(value);
    case "severities":
      return isSeverityMap(value, Object.keys(spec.kinds));
    default: {
      const unreachable: never = spec;
      return unreachable;
    }
  }
}

/** Why `value` is not a valid value of `spec`, as "must be …, got …"; undefined when it is. */
export function optionProblem(spec: OptionSpec, value: unknown): string | undefined {
  return accepts(spec, value)
    ? undefined
    : `must be ${expectation(spec)}, got ${describeGiven(value)}`;
}

/** The default of every option: what a rule receives when the config sets nothing. */
export function defaultOptions(specs: OptionSpecs | undefined): Options {
  return Object.fromEntries(
    Object.entries(specs ?? {}).map(([name, spec]) => [name, spec.default]),
  );
}

/**
 * The options of rule `ruleId` from what the config gave (`given`, untrusted): defaults filled
 * in, and one error per unknown name or value that does not fit, each naming rule and option.
 */
export function parseRuleOptions(
  ruleId: string,
  specs: OptionSpecs | undefined,
  given: unknown,
  errors: string[],
): Options {
  const declared = specs ?? {};
  const where = `rules["${ruleId}"]`;
  if (typeof given !== "object" || given === null || Array.isArray(given)) {
    errors.push(
      `${where}: options must be an object of option names to values, got ${describeGiven(given)}`,
    );
    return defaultOptions(specs);
  }
  const names = Object.keys(declared);
  const values: Record<string, OptionValue> = { ...defaultOptions(specs) };
  for (const [name, value] of Object.entries(given)) {
    const spec = declared[name];
    if (spec === undefined) {
      errors.push(
        names.length === 0
          ? `${where} takes no options, got "${name}"`
          : `${where} has no option "${name}"; its options: ${names.join(", ")}`,
      );
      continue;
    }
    const problem = optionProblem(spec, value);
    if (problem === undefined && accepts(spec, value)) values[name] = value;
    else errors.push(`${where}.${name} ${problem ?? "is not valid"}`);
  }
  return values;
}
