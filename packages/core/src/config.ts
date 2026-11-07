import path from "node:path";
import type {
  Config,
  LibraryTypes,
  ConfigOverride,
  EditorContributions,
  ExtendedConfig,
  IgnoreOptions,
  UnknownsSetting,
  FunctionFacts,
  PackageFactsConfig,
  OptionSpec,
  OptionSpecs,
  Options,
  FileRule,
  ParseResult,
  Plugin,
  Preset,
  ProjectRule,
  LazyRule,
  PluginRule,
  RuleInfo,
  RuleMeta,
  RuleSetting,
  RuleTier,
  SeverityMap,
  Severity,
  UserConfig,
} from "./types.js";
import { addonNames, groupIds } from "./severity.js";
import { PRESETS, RULE_TIERS, orList } from "./vocabulary.js";
import { defaultOptions, optionProblem, parseRuleOptions } from "./options.js";

const DEFAULT_TSCONFIG = "tsconfig.json";
/**
 * What stateward checks when the config does not say: import it to add to the lists instead of
 * replacing them, for example `exclude: [...defaults.exclude, "src/generated/**"]`.
 */
export const defaults: {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
} = Object.freeze({
  include: Object.freeze(["**/*.ts", "**/*.tsx"]),
  exclude: Object.freeze([
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
  ]),
});
const CONFIG_KEYS: readonly string[] = [
  "tsconfig",
  "include",
  "exclude",
  "plugins",
  "preset",
  "addons",
  "rules",
  "groups",
  "rollout",
  "facts",
  "extends",
  "overrides",
  "ignores",
  "unknowns",
  "maxMemory",
];
const UNKNOWNS: readonly UnknownsSetting[] = ["info", "warning", "off"];
const OVERRIDE_KEYS: readonly string[] = ["files", "rules", "groups", "preset", "addons"];
const IGNORE_KEYS: readonly string[] = ["requireReason", "reportUnused"];
const REPORT_UNUSED: readonly string[] = ["error", "warning", "off"];
const DEFAULT_IGNORES: IgnoreOptions = { requireReason: true, reportUnused: "warning" };
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Identity function that gives a config file its types. */
export function defineConfig<
  const P extends readonly Plugin[] = readonly [],
  const E extends readonly ExtendedConfig[] = readonly [],
>(config: UserConfig<P, E>): UserConfig<P, E> {
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is Severity {
  return value === "error" || value === "warning" || value === "info";
}

function isTier(value: unknown): value is RuleTier {
  return RULE_TIERS.some((tier) => tier === value);
}

/** Whether `value` is the name of a preset. */
export function isPreset(value: unknown): value is Preset {
  return PRESETS.some((preset) => preset === value);
}

function isRuleSetting(value: unknown): value is RuleSetting {
  return value === "off" || isSeverity(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function isStringListRecordValue(
  value: unknown,
): value is Readonly<Record<string, readonly string[]>> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

type HoverFn = NonNullable<EditorContributions["hover"]>;
type TokensFn = NonNullable<EditorContributions["tokens"]>;
type CodeActionsFn = NonNullable<EditorContributions["codeActions"]>;
type InlayHintsFn = NonNullable<EditorContributions["inlayHints"]>;
type LibraryFactsFn = NonNullable<EditorContributions["libraryFacts"]>;
type GuaranteesFn = NonNullable<EditorContributions["guarantees"]>;

/* Functions cannot be checked beyond `typeof`; the declared signature is the plugin's promise. */
const isFileCheck = (value: unknown): value is FileRule["check"] => typeof value === "function";
const isProjectCheck = (value: unknown): value is ProjectRule["check"] =>
  typeof value === "function";
const isSummarize = (value: unknown): value is ProjectRule["summarize"] =>
  typeof value === "function";
const isSilentReason = (value: unknown): value is NonNullable<ProjectRule["silentReason"]> =>
  typeof value === "function";
const isHover = (value: unknown): value is HoverFn => typeof value === "function";
const isInlayHints = (value: unknown): value is InlayHintsFn => typeof value === "function";
const isGuarantees = (value: unknown): value is GuaranteesFn => typeof value === "function";
const isCodeActions = (value: unknown): value is CodeActionsFn => typeof value === "function";
const isTokens = (value: unknown): value is TokensFn => typeof value === "function";
const isLibraryFacts = (value: unknown): value is LibraryFactsFn => typeof value === "function";

const OPTION_KINDS = "boolean, number, string, strings, record or severities";

/** The entries of `value` that are severities; `optionProblem` then judges the whole default. */
function severityMapOf(value: Record<string, unknown>): SeverityMap {
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, setting]): [string, RuleSetting][] => {
      const found = SETTINGS.find((word) => word === setting);
      return found === undefined ? [] : [[name, found]];
    }),
  );
}

const SETTINGS: readonly RuleSetting[] = ["error", "warning", "info", "off"];

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/** One declared option, rebuilt from its fields; the default must itself be valid. */
function parseOptionSpec(value: unknown, where: string, errors: string[]): OptionSpec | undefined {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object (build it with option.*)`);
    return undefined;
  }
  const { kind, description, min, max, integer, oneOf, kinds } = value;
  if (typeof description !== "string" || description === "") {
    errors.push(`${where}.description must be a non-empty string`);
    return undefined;
  }
  let spec: OptionSpec | undefined;
  switch (kind) {
    case "boolean":
      spec = { kind, description, default: value.default === true };
      break;
    case "number":
      if (
        !optionalNumber(min) ||
        !optionalNumber(max) ||
        (integer !== undefined && typeof integer !== "boolean")
      ) {
        errors.push(`${where}: min and max must be numbers and integer a boolean`);
        return undefined;
      }
      spec = {
        kind,
        description,
        default: typeof value.default === "number" ? value.default : Number.NaN,
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(integer === undefined ? {} : { integer }),
      };
      break;
    case "string":
      if (oneOf !== undefined && !isStringArray(oneOf)) {
        errors.push(`${where}.oneOf must be a list of strings`);
        return undefined;
      }
      spec = {
        kind,
        description,
        default: typeof value.default === "string" ? value.default : "",
        ...(oneOf === undefined ? {} : { oneOf }),
      };
      break;
    case "strings":
      spec = { kind, description, default: isStringArray(value.default) ? value.default : [] };
      break;
    case "record":
      spec = {
        kind,
        description,
        default: isStringListRecordValue(value.default) ? value.default : {},
      };
      break;
    case "severities": {
      const named = isRecord(kinds) ? Object.entries(kinds) : [];
      const described = named.flatMap(([name, text]): [string, string][] =>
        typeof text === "string" && text !== "" ? [[name, text]] : [],
      );
      if (described.length === 0 || described.length !== named.length) {
        errors.push(`${where}.kinds must name each kind with a non-empty description`);
        return undefined;
      }
      spec = {
        kind,
        description,
        kinds: Object.fromEntries(described),
        default: isRecord(value.default) ? severityMapOf(value.default) : {},
      };
      break;
    }
    default:
      errors.push(`${where}.kind must be ${OPTION_KINDS}`);
      return undefined;
  }
  const problem = optionProblem(spec, value.default);
  if (problem !== undefined) {
    errors.push(`${where}.default ${problem}`);
    return undefined;
  }
  return spec;
}

function parseOptionSpecs(
  value: unknown,
  where: string,
  errors: string[],
): OptionSpecs | undefined {
  if (!isRecord(value)) {
    errors.push(`${where}.meta.options must be an object`);
    return undefined;
  }
  const specs: Record<string, OptionSpec> = {};
  let valid = true;
  for (const [name, item] of Object.entries(value)) {
    const spec = parseOptionSpec(item, `${where}.meta.options.${name}`, errors);
    if (spec === undefined) valid = false;
    else specs[name] = spec;
  }
  return valid ? specs : undefined;
}

/** The metadata of a rule whose code is given: what `parseInfo` reads, and its `explain` text. */
function parseMeta(value: unknown, where: string, errors: string[]): RuleMeta | undefined {
  if (isRecord(value) && typeof value.explain !== "string") {
    errors.push(`${where}.meta.explain must be a string`);
    return undefined;
  }
  const info = parseInfo(value, where, errors);
  if (info === undefined || !isRecord(value) || typeof value.explain !== "string") return undefined;
  return { ...info, explain: value.explain };
}

/** `RuleInfo.needsTypes` as given: undefined when left out, "invalid" when not a `LibraryTypes`. */
function parseNeedsTypes(value: unknown): LibraryTypes | "invalid" | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "invalid";
  const { library, modules } = value;
  if (typeof library !== "string" || library === "") return "invalid";
  if (!isStringArray(modules) || modules.length === 0) return "invalid";
  return { library, modules: [...modules] };
}

/** The metadata a pack declares up front (`RuleInfo`): everything but the `explain` text. */
function parseInfo(value: unknown, where: string, errors: string[]): RuleInfo | undefined {
  const found = parseInfoFields(value, where, errors);
  if (found === undefined || !isRecord(value)) return found;
  const shared = value.sharedOptions;
  if (
    shared !== undefined &&
    !(isRecord(shared) && Object.values(shared).every((rule) => typeof rule === "string"))
  ) {
    errors.push(`${where}.meta.sharedOptions must map option names to rule keys of the same pack`);
    return undefined;
  }
  const sharing =
    shared === undefined
      ? found
      : {
          ...found,
          sharedOptions: Object.fromEntries(
            Object.entries(shared).map(([name, rule]) => [name, String(rule)]),
          ),
        };
  const { fixNeedsStrictNulls } = value;
  const needsTypes = parseNeedsTypes(value.needsTypes);
  if (needsTypes === "invalid") {
    errors.push(
      `${where}.meta.needsTypes must be { library: "<name>", modules: ["<module>", …] } when present`,
    );
    return undefined;
  }
  if (fixNeedsStrictNulls !== undefined && fixNeedsStrictNulls !== true) {
    errors.push(`${where}.meta.fixNeedsStrictNulls must be true when present`);
    return undefined;
  }
  const typed =
    needsTypes === undefined
      ? sharing
      : {
          ...sharing,
          needsTypes,
        };
  const info =
    fixNeedsStrictNulls === true ? { ...typed, fixNeedsStrictNulls: true as const } : typed;
  if (value.options === undefined) return info;
  const options = parseOptionSpecs(value.options, where, errors);
  return options === undefined ? undefined : { ...info, options };
}

function parseInfoFields(value: unknown, where: string, errors: string[]): RuleInfo | undefined {
  if (!isRecord(value)) {
    errors.push(`${where}.meta must be an object`);
    return undefined;
  }
  const { description, summary, defaultSeverity, tier, group, addon, heuristic, widenedBy } = value;
  const { needsJsDoc, listUnknowns, yieldsTo } = value;
  if (typeof description !== "string") {
    errors.push(`${where}.meta.description must be a string`);
    return undefined;
  }
  if (summary !== undefined && typeof summary !== "string") {
    errors.push(`${where}.meta.summary must be a string when present`);
    return undefined;
  }
  if (!isSeverity(defaultSeverity)) {
    errors.push(`${where}.meta.defaultSeverity must be "error", "warning" or "info"`);
    return undefined;
  }
  if (!isTier(tier)) {
    errors.push(`${where}.meta.tier must be ${orList(RULE_TIERS)}`);
    return undefined;
  }
  if (heuristic !== undefined && heuristic !== true) {
    errors.push(`${where}.meta.heuristic must be true when present`);
    return undefined;
  }
  if (needsJsDoc !== undefined && needsJsDoc !== true) {
    errors.push(`${where}.meta.needsJsDoc must be true when present`);
    return undefined;
  }
  if (listUnknowns !== undefined && listUnknowns !== true) {
    errors.push(`${where}.meta.listUnknowns must be true when present`);
    return undefined;
  }
  if (typeof group !== "string" || !KEBAB_CASE.test(group)) {
    errors.push(`${where}.meta.group must name the rule's group in kebab-case, e.g. "switches"`);
    return undefined;
  }
  const described = { description, defaultSeverity, tier, group };
  const base = summary === undefined ? described : { ...described, summary };
  const guessed = heuristic === true ? { ...base, heuristic: true as const } : base;
  const reading = needsJsDoc === true ? { ...guessed, needsJsDoc: true as const } : guessed;
  const listing = listUnknowns === true ? { ...reading, listUnknowns: true as const } : reading;
  if (yieldsTo !== undefined && !isStringArray(yieldsTo)) {
    errors.push(`${where}.meta.yieldsTo must be a list of rule keys of the same pack`);
    return undefined;
  }
  const flagged = yieldsTo === undefined ? listing : { ...listing, yieldsTo };
  if (tier !== "addon") {
    if (addon !== undefined) {
      errors.push(`${where}.meta.addon is only for tier "addon", not "${tier}"`);
      return undefined;
    }
    if (widenedBy === undefined) return flagged;
    if (!isStringArray(widenedBy) || !widenedBy.every((name) => KEBAB_CASE.test(name))) {
      errors.push(`${where}.meta.widenedBy must be a list of add-on names in kebab-case`);
      return undefined;
    }
    return { ...flagged, widenedBy };
  }
  if (widenedBy !== undefined) {
    errors.push(`${where}.meta.widenedBy is only for tiers "core" and "coverage", not "addon"`);
    return undefined;
  }
  if (typeof addon !== "string" || !KEBAB_CASE.test(addon)) {
    errors.push(`${where}.meta.addon must name the add-on in kebab-case when tier is "addon"`);
    return undefined;
  }
  return { ...flagged, addon };
}

const isLoad = (value: unknown): value is LazyRule["load"] => typeof value === "function";
const isLoaded = (value: unknown): value is LazyRule["loaded"] => typeof value === "function";

function parseRule(value: unknown, where: string, errors: string[]): PluginRule | undefined {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object`);
    return undefined;
  }
  if (value.kind === "lazy") return parseLazyRule(value, where, errors);
  const meta = parseMeta(value.meta, where, errors);
  if (meta === undefined) return undefined;
  const { kind, check, summarize, silentReason } = value;
  if (kind === "file" && isFileCheck(check)) {
    return { kind, meta, check };
  }
  if (kind === "project" && isProjectCheck(check) && isSummarize(summarize)) {
    return isSilentReason(silentReason)
      ? { kind, meta, check, summarize, silentReason }
      : { kind, meta, check, summarize };
  }
  errors.push(
    `${where} must be a "file" rule with check(), a "project" rule with summarize() and check(), or a "lazy" rule with load()`,
  );
  return undefined;
}

function parseLazyRule(
  value: Record<string, unknown>,
  where: string,
  errors: string[],
): LazyRule | undefined {
  const meta = parseInfo(value.meta, where, errors);
  if (meta === undefined) return undefined;
  const { ruleKind, load, loaded } = value;
  if ((ruleKind === "file" || ruleKind === "project") && isLoad(load) && isLoaded(loaded)) {
    return { kind: "lazy", ruleKind, meta, load, loaded };
  }
  errors.push(
    `${where} is a "lazy" rule: it needs ruleKind "file" or "project", load() and loaded() (build it with lazyRule)`,
  );
  return undefined;
}

function parseEditor(
  value: unknown,
  where: string,
  errors: string[],
): EditorContributions | undefined {
  if (!isRecord(value)) {
    errors.push(`${where}.editor must be an object`);
    return undefined;
  }
  const { hover, tokens, libraryFacts, inlayHints, codeActions, guarantees } = value;
  const editor: {
    hover?: HoverFn;
    tokens?: TokensFn;
    libraryFacts?: LibraryFactsFn;
    guarantees?: GuaranteesFn;
    inlayHints?: InlayHintsFn;
    codeActions?: CodeActionsFn;
  } = {};
  if (codeActions !== undefined) {
    if (!isCodeActions(codeActions)) {
      errors.push(`${where}.editor.codeActions must be a function`);
      return undefined;
    }
    editor.codeActions = codeActions;
  }
  if (inlayHints !== undefined) {
    if (!isInlayHints(inlayHints)) {
      errors.push(`${where}.editor.inlayHints must be a function`);
      return undefined;
    }
    editor.inlayHints = inlayHints;
  }
  if (libraryFacts !== undefined) {
    if (!isLibraryFacts(libraryFacts)) {
      errors.push(`${where}.editor.libraryFacts must be a function`);
      return undefined;
    }
    editor.libraryFacts = libraryFacts;
  }
  if (guarantees !== undefined) {
    if (!isGuarantees(guarantees)) {
      errors.push(`${where}.editor.guarantees must be a function`);
      return undefined;
    }
    editor.guarantees = guarantees;
  }
  if (hover !== undefined) {
    if (!isHover(hover)) {
      errors.push(`${where}.editor.hover must be a function`);
      return undefined;
    }
    editor.hover = hover;
  }
  if (tokens !== undefined) {
    if (!isTokens(tokens)) {
      errors.push(`${where}.editor.tokens must be a function`);
      return undefined;
    }
    editor.tokens = tokens;
  }
  return editor;
}

function parsePlugin(value: unknown, index: number, errors: string[]): Plugin | undefined {
  if (!isRecord(value)) {
    errors.push(`plugins[${String(index)}] must be an object`);
    return undefined;
  }
  const { name, description, rules, editor } = value;
  if (typeof name !== "string" || name === "" || name.includes("/")) {
    errors.push(`plugins[${String(index)}].name must be a non-empty string without "/"`);
    return undefined;
  }
  const where = `plugin "${name}"`;
  if (typeof description !== "string" || description === "") {
    errors.push(`${where}: description must be a non-empty string`);
    return undefined;
  }
  if (!isRecord(rules)) {
    errors.push(`${where}: rules must be an object`);
    return undefined;
  }
  const parsedRules: Record<string, PluginRule> = {};
  let valid = true;
  for (const [key, rule] of Object.entries(rules)) {
    const parsed = parseRule(rule, `${where}: rule "${key}"`, errors);
    if (parsed === undefined) valid = false;
    else parsedRules[key] = parsed;
  }
  if (!valid) return undefined;
  if (editor === undefined) return { name, description, rules: parsedRules };
  const parsedEditor = parseEditor(editor, where, errors);
  return parsedEditor === undefined
    ? undefined
    : { name, description, rules: parsedRules, editor: parsedEditor };
}

function parsePlugins(value: unknown, errors: string[]): readonly Plugin[] {
  if (!Array.isArray(value)) {
    errors.push("plugins must be an array");
    return [];
  }
  const plugins: Plugin[] = [];
  const seen = new Set<string>();
  value.forEach((item: unknown, index) => {
    const plugin = parsePlugin(item, index, errors);
    if (plugin === undefined) return;
    if (seen.has(plugin.name)) errors.push(`duplicate plugin name "${plugin.name}"`);
    seen.add(plugin.name);
    plugins.push(plugin);
  });
  return plugins;
}

/** `"error"`, `"off"` ..., or `[severity, { options }]`: the severity and the raw options, if any. */
function splitRuleConfig(value: unknown): { setting: RuleSetting; options: unknown } | undefined {
  if (isRuleSetting(value)) return { setting: value, options: undefined };
  if (Array.isArray(value) && value.length === 2) {
    const setting: unknown = value[0];
    const options: unknown = value[1];
    if (isRuleSetting(setting)) return { setting, options };
  }
  return undefined;
}

function parseRuleSettings(
  value: unknown,
  plugins: readonly Plugin[],
  errors: string[],
): {
  rules: Readonly<Record<string, RuleSetting>>;
  ruleOptions: Readonly<Record<string, Options>>;
} {
  if (!isRecord(value)) {
    errors.push("rules must be an object");
    return { rules: {}, ruleOptions: {} };
  }
  const known = new Map<string, PluginRule>(
    plugins.flatMap((plugin) =>
      Object.entries(plugin.rules).map(([key, rule]) => [`${plugin.name}/${key}`, rule] as const),
    ),
  );
  const settings: Record<string, RuleSetting> = {};
  const given = new Map<string, unknown>();
  for (const [ruleId, entry] of Object.entries(value)) {
    const split = splitRuleConfig(entry);
    if (!known.has(ruleId)) errors.push(`rules: unknown rule id "${ruleId}"`);
    else if (split === undefined) {
      errors.push(
        `rules["${ruleId}"] must be "error", "warning", "info", "off", or [severity, { options }]`,
      );
    } else {
      settings[ruleId] = split.setting;
      given.set(ruleId, split.options);
    }
  }
  // Every rule that declares options gets its full, defaulted set, listed in the config or not.
  const ruleOptions: Record<string, Options> = {};
  for (const [ruleId, rule] of known) {
    const raw = given.get(ruleId);
    const specs = rule.meta.options;
    if (raw !== undefined) ruleOptions[ruleId] = parseRuleOptions(ruleId, specs, raw, errors);
    else if (specs !== undefined) ruleOptions[ruleId] = defaultOptions(specs);
  }
  return { rules: settings, ruleOptions };
}

function parseGroupSettings(
  value: unknown,
  plugins: readonly Plugin[],
  errors: string[],
  name = "groups",
): Readonly<Record<string, RuleSetting>> {
  if (!isRecord(value)) {
    errors.push(`${name} must be an object`);
    return {};
  }
  const known = groupIds(plugins);
  const settings: Record<string, RuleSetting> = {};
  for (const [groupId, setting] of Object.entries(value)) {
    if (!known.includes(groupId)) {
      errors.push(`${name}: ${unknownGroupMessage(groupId, plugins, known)}`);
    } else if (!isRuleSetting(setting)) {
      errors.push(`${name}["${groupId}"] must be "error", "warning", "info" or "off"`);
    } else {
      settings[groupId] = setting;
    }
  }
  return settings;
}

/** Names the groups of the plugin `groupId` starts with, or the plugins when that is unknown too. */
function unknownGroupMessage(
  groupId: string,
  plugins: readonly Plugin[],
  known: readonly string[],
): string {
  const owner = plugins.find((plugin) => groupId.startsWith(`${plugin.name}/`));
  if (owner === undefined) {
    const names = plugins.map((plugin) => plugin.name).join(", ") || "none";
    return `unknown group "${groupId}": no loaded plugin matches; plugins: ${names}`;
  }
  const prefix = `${owner.name}/`;
  const groups = known.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  return `unknown group "${groupId}"; groups of ${owner.name}: ${groups.join(", ") || "none"}`;
}

function parseStringList(
  value: unknown,
  name: string,
  fallback: readonly string[],
  errors: string[],
): readonly string[] {
  if (value === undefined) return fallback;
  if (!isStringArray(value)) {
    errors.push(`${name} must be an array of strings`);
    return fallback;
  }
  return value;
}

/** A preset, or undefined when none is named: then no rule is on until the config turns it on. */
function parsePreset(value: unknown, errors: string[], name = "preset"): Preset | undefined {
  if (value === undefined) return undefined;
  if (isPreset(value)) return value;
  errors.push(`${name} must be ${orList(PRESETS)}`);
  return undefined;
}

function parseAddons(
  value: unknown,
  plugins: readonly Plugin[],
  errors: string[],
  name = "addons",
): readonly string[] {
  const listed = parseStringList(value, name, [], errors);
  const known = addonNames(plugins);
  for (const entry of listed) {
    if (!known.includes(entry)) {
      const offered = known.join(", ") || "none";
      errors.push(`${name}: unknown add-on "${entry}"; add-ons of the loaded plugins: ${offered}`);
    }
  }
  return listed;
}

const FACT_KINDS: readonly string[] = ["throws", "rejects"];

/** `facts: { axios: { get: { throws: ["AxiosError"] } } }`. */
function parseFacts(value: unknown, errors: string[]): PackageFactsConfig {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    errors.push("facts must be an object: { <package>: { <function>: { throws: [...] } } }");
    return {};
  }
  const facts: Record<string, Readonly<Record<string, FunctionFacts>>> = {};
  for (const [name, functions] of Object.entries(value)) {
    if (!isRecord(functions)) {
      errors.push(`facts["${name}"] must be an object of functions`);
      continue;
    }
    const parsed: Record<string, FunctionFacts> = {};
    for (const [fn, entry] of Object.entries(functions)) {
      const where = `facts["${name}"]["${fn}"]`;
      if (!isRecord(entry)) {
        errors.push(`${where} must be an object: { throws: [...], rejects: [...] }`);
        continue;
      }
      const one: { throws?: readonly string[]; rejects?: readonly string[] } = {};
      for (const [kind, list] of Object.entries(entry)) {
        if (!FACT_KINDS.includes(kind)) {
          errors.push(`${where}: unknown fact "${kind}"; facts are ${orList(FACT_KINDS)}`);
        } else if (!isStringArray(list)) {
          errors.push(`${where}.${kind} must be an array of class names`);
        } else if (kind === "throws") {
          one.throws = list;
        } else {
          one.rejects = list;
        }
      }
      parsed[fn] = one;
    }
    facts[name] = parsed;
  }
  return facts;
}

function parseUnknowns(value: unknown, errors: string[]): UnknownsSetting {
  if (value === undefined) return "info";
  const found = UNKNOWNS.find((word) => word === value);
  if (found !== undefined) return found;
  errors.push(`unknowns must be ${orList(UNKNOWNS)}, got ${describeValue(value)}`);
  return "info";
}

/** The least `maxMemory` (MB): below it Node cannot even load TypeScript. */
export const MIN_MAX_MEMORY = 512;

/** Whether `value` is a memory limit stateward accepts: a whole number of MB, at least 512. */
export function isMaxMemory(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_MAX_MEMORY;
}

function parseMaxMemory(value: unknown, errors: string[]): number | undefined {
  if (value === undefined || isMaxMemory(value)) return value;
  errors.push(
    `maxMemory must be a whole number of MB, at least ${String(MIN_MAX_MEMORY)} (like 6144), got ${describeValue(value)}`,
  );
  return undefined;
}

function parseRollout(value: unknown, errors: string[]): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  errors.push("rollout must be true or false");
  return false;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "nothing";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return Array.isArray(value) ? "a list" : "an object";
}

/** `overrides[i].rules`: severities only, because a rule's options are the same in every file. */
function parseOverrideRules(
  value: unknown,
  plugins: readonly Plugin[],
  errors: string[],
  name: string,
): Readonly<Record<string, RuleSetting>> {
  if (!isRecord(value)) {
    errors.push(`${name} must be an object`);
    return {};
  }
  const known = new Set(
    plugins.flatMap((plugin) => Object.keys(plugin.rules).map((key) => `${plugin.name}/${key}`)),
  );
  const settings: Record<string, RuleSetting> = {};
  for (const [ruleId, entry] of Object.entries(value)) {
    if (!known.has(ruleId)) {
      errors.push(`${name}: unknown rule id "${ruleId}"`);
    } else if (Array.isArray(entry)) {
      errors.push(
        `${name}["${ruleId}"] takes a severity or "off", not options; set a rule's options once, in the config's own rules`,
      );
    } else if (!isRuleSetting(entry)) {
      errors.push(`${name}["${ruleId}"] must be "error", "warning", "info" or "off"`);
    } else {
      settings[ruleId] = entry;
    }
  }
  return settings;
}

function parseOverrides(
  value: unknown,
  plugins: readonly Plugin[],
  errors: string[],
): readonly ConfigOverride[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("overrides must be an array of { files: [...], rules: {...} }");
    return [];
  }
  const parsed: ConfigOverride[] = [];
  value.forEach((item: unknown, index) => {
    const name = `overrides[${String(index)}]`;
    if (!isRecord(item)) {
      errors.push(`${name} must be an object: { files: ["src/legacy/**"], rules: { ... } }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!OVERRIDE_KEYS.includes(key)) {
        errors.push(`${name}: unknown key "${key}"; an override takes ${orList(OVERRIDE_KEYS)}`);
      }
    }
    const { files } = item;
    if (!Array.isArray(files) || files.length === 0) {
      errors.push(`${name}.files must be a list of globs, like ["src/legacy/**"]`);
    } else {
      files.forEach((glob: unknown, at) => {
        if (typeof glob !== "string") {
          errors.push(
            `${name}.files[${String(at)}] must be a string glob like "src/legacy/**", not ${describeValue(glob)}`,
          );
        }
      });
    }
    const preset =
      item.preset === undefined ? undefined : parsePreset(item.preset, errors, `${name}.preset`);
    parsed.push({
      files: isStringArray(files) ? files : [],
      ...(preset === undefined ? {} : { preset }),
      addons: parseAddons(item.addons, plugins, errors, `${name}.addons`),
      groups: parseGroupSettings(item.groups ?? {}, plugins, errors, `${name}.groups`),
      rules: parseOverrideRules(item.rules ?? {}, plugins, errors, `${name}.rules`),
    });
  });
  return parsed;
}

function parseIgnores(value: unknown, errors: string[]): IgnoreOptions {
  if (value === undefined) return DEFAULT_IGNORES;
  if (!isRecord(value)) {
    errors.push('ignores must be an object: { requireReason: true, reportUnused: "warning" }');
    return DEFAULT_IGNORES;
  }
  for (const key of Object.keys(value)) {
    if (!IGNORE_KEYS.includes(key)) {
      errors.push(`ignores: unknown key "${key}"; ignores takes ${orList(IGNORE_KEYS)}`);
    }
  }
  const { requireReason, reportUnused } = value;
  if (requireReason !== undefined && typeof requireReason !== "boolean") {
    errors.push("ignores.requireReason must be true or false");
  }
  if (reportUnused !== undefined && !REPORT_UNUSED.some((word) => word === reportUnused)) {
    errors.push(`ignores.reportUnused must be ${orList(REPORT_UNUSED)}`);
  }
  return {
    requireReason:
      typeof requireReason === "boolean" ? requireReason : DEFAULT_IGNORES.requireReason,
    reportUnused:
      reportUnused === "error" || reportUnused === "warning" || reportUnused === "off"
        ? reportUnused
        : DEFAULT_IGNORES.reportUnused,
  };
}

// ---- extends -----------------------------------------------------------------------------------

/** How a config is named in an error: the file itself, or the `extends` entry it came from. */
type Origin = { name: string };

/**
 * The configs to merge, in order: each extended config (and what it extends) before the config
 * that extends it. Configs are values, not paths, so a config cannot extend itself by name; a
 * value that reaches itself through `extends` is reported, not followed.
 */
function configChain(
  config: Record<string, unknown>,
  origin: Origin,
  stack: readonly object[],
  errors: string[],
): { config: Record<string, unknown>; origin: Origin }[] {
  const prefix = origin.name === "your config" ? "" : `${origin.name}: `;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) errors.push(`${prefix}unknown config key "${key}"`);
  }
  const chain: { config: Record<string, unknown>; origin: Origin }[] = [];
  const { extends: extended } = config;
  if (extended !== undefined) {
    if (!Array.isArray(extended)) {
      errors.push(`${prefix}extends must be a list of shared configs, like extends: [team]`);
    } else {
      extended.forEach((item: unknown, index) => {
        const name = `${origin.name === "your config" ? "" : `${origin.name}.`}extends[${String(index)}]`;
        if (!isRecord(item)) {
          errors.push(
            `${name} must be a config: what a shared config package exports with defineConfig({ ... })`,
          );
        } else if (stack.includes(item) || item === config) {
          errors.push(`${name} extends a config that extends it back; remove one of the two`);
        } else {
          chain.push(...configChain(item, { name }, [...stack, config], errors));
        }
      });
    }
  }
  chain.push({ config, origin });
  return chain;
}

/** A plugin's code as text, to tell one package loaded twice from two packages sharing a name. */
function pluginSignature(plugin: unknown): string {
  if (!isRecord(plugin) || !isRecord(plugin.rules)) return "";
  // A lazy rule's code is not loaded yet: its metadata says which package it is.
  const rules = Object.entries(plugin.rules).map(([key, rule]) =>
    isRecord(rule)
      ? rule.kind === "lazy"
        ? [key, JSON.stringify(rule.meta)]
        : [key, String(rule.check), String(rule.summarize)]
      : [key],
  );
  return JSON.stringify([plugin.name, rules]);
}

function nameOf(plugin: unknown): string | undefined {
  return isRecord(plugin) && typeof plugin.name === "string" ? plugin.name : undefined;
}

/**
 * The plugins of all configs joined by name: the first position a name had, the last instance of
 * it. The same package twice (the team config and this one both import it) is fine; two packages
 * that share a plugin name would silently replace each other's rules, so that is an error.
 */
function joinPlugins(
  chain: readonly { config: Record<string, unknown>; origin: Origin }[],
  errors: string[],
): unknown {
  let joined: unknown[] | undefined;
  const from = new Map<string, Origin>();
  for (const { config, origin } of chain) {
    const { plugins } = config;
    if (plugins === undefined) continue;
    if (!Array.isArray(plugins)) {
      errors.push(
        `${origin.name === "your config" ? "" : `${origin.name}: `}plugins must be an array`,
      );
      continue;
    }
    joined ??= [];
    const own = new Set<string>();
    const list: unknown[] = plugins;
    for (const plugin of list) {
      const name = nameOf(plugin);
      const at = joined.findIndex((one) => name !== undefined && nameOf(one) === name);
      const earlier = name === undefined ? undefined : from.get(name);
      if (name === undefined || at === -1 || own.has(name)) {
        joined.push(plugin);
      } else if (pluginSignature(joined[at]) === pluginSignature(plugin)) {
        joined[at] = plugin;
      } else {
        errors.push(
          `plugin "${name}" comes from two different packages (${earlier?.name ?? "an earlier config"} and ${origin.name}); keep one of them`,
        );
      }
      if (name !== undefined) {
        own.add(name);
        from.set(name, origin);
      }
    }
  }
  return joined;
}

/**
 * How a later config's entry joins an earlier one: replaced whole (`"replace"`), objects merged
 * key by key (`"deep"`), or a rule's setting (`"rule"`): a severity alone keeps the earlier
 * options (`["error", { maxHidden: 10 }]` then `"warning"` gives `["warning", { maxHidden: 10 }]`),
 * while a setting with options replaces the options object whole.
 */
type MergeMode = "replace" | "deep" | "rule";

function mergeEntry(before: unknown, entry: unknown, mode: MergeMode): unknown {
  if (mode === "deep" && isRecord(before) && isRecord(entry)) return { ...before, ...entry };
  if (mode === "rule" && isRuleSetting(entry)) {
    const split = splitRuleConfig(before);
    if (split?.options !== undefined) return [entry, split.options];
  }
  return entry;
}

/** Objects merged key by key, the later config's value winning; anything else is left for the parser to report. */
function mergeRecords(
  chain: readonly { config: Record<string, unknown>; origin: Origin }[],
  key: string,
  errors: string[],
  mode: MergeMode,
): unknown {
  let merged: Record<string, unknown> | undefined;
  for (const { config, origin } of chain) {
    const value = config[key];
    if (value === undefined) continue;
    if (!isRecord(value)) {
      errors.push(
        `${origin.name === "your config" ? "" : `${origin.name}: `}${key} must be an object`,
      );
      continue;
    }
    merged ??= {};
    for (const [name, entry] of Object.entries(value)) {
      const before = merged[name];
      merged[name] = mergeEntry(before, entry, mode);
    }
  }
  return merged;
}

/** The last config that sets `key`. */
function lastOf(
  chain: readonly { config: Record<string, unknown>; origin: Origin }[],
  key: string,
): unknown {
  return chain
    .map(({ config }) => config[key])
    .filter((value) => value !== undefined)
    .at(-1);
}

/**
 * All the configs in `chain` as one: plugins joined by name; `rules`, `groups` and `facts` merged
 * per key (a rule's options as `MergeMode` says); `addons` and `overrides` joined in order (an override of this config comes after the
 * shared ones, so it wins); `ignores` per option; every other key takes the last value.
 */
function mergeChain(
  chain: readonly { config: Record<string, unknown>; origin: Origin }[],
  errors: string[],
): Record<string, unknown> {
  if (chain.length === 1) return chain[0]?.config ?? {};
  const merged: Record<string, unknown> = {};
  for (const key of [
    "tsconfig",
    "include",
    "exclude",
    "preset",
    "rollout",
    "unknowns",
    "maxMemory",
  ]) {
    const value = lastOf(chain, key);
    if (value !== undefined) merged[key] = value;
  }
  const plugins = joinPlugins(chain, errors);
  if (plugins !== undefined) merged.plugins = plugins;
  const lists = (key: string): unknown[] | undefined => {
    const found = chain.flatMap(({ config, origin }) => {
      const value = config[key];
      if (value === undefined) return [];
      if (Array.isArray(value)) {
        const list: unknown[] = value;
        return list;
      }
      errors.push(
        `${origin.name === "your config" ? "" : `${origin.name}: `}${key} must be an array`,
      );
      return [];
    });
    return chain.some(({ config }) => config[key] !== undefined) ? found : undefined;
  };
  const addons = lists("addons");
  if (addons !== undefined) merged.addons = [...new Set(addons)];
  const overrides = lists("overrides");
  if (overrides !== undefined) merged.overrides = overrides;
  const rules = mergeRecords(chain, "rules", errors, "rule");
  if (rules !== undefined) merged.rules = rules;
  const groups = mergeRecords(chain, "groups", errors, "replace");
  if (groups !== undefined) merged.groups = groups;
  const facts = mergeRecords(chain, "facts", errors, "deep");
  if (facts !== undefined) merged.facts = facts;
  const ignores = mergeRecords(chain, "ignores", errors, "replace");
  if (ignores !== undefined) merged.ignores = ignores;
  return merged;
}

/** `tsconfig`: one path, or a non-empty list of paths and globs; undefined after an error. */
function parseTsconfig(value: unknown, errors: string[]): readonly string[] | undefined {
  if (value === undefined) return [DEFAULT_TSCONFIG];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    const strings = list.filter((entry): entry is string => typeof entry === "string");
    if (strings.length > 0 && strings.length === list.length) return strings;
  }
  errors.push(
    'tsconfig must be a path or a list of paths and globs, like "tsconfig.json" or ["packages/*/tsconfig.json"]',
  );
  return undefined;
}

/**
 * Validates untrusted config input once. `tsconfig` is resolved against `configDir`, so the
 * returned value holds absolute paths (and absolute globs).
 */
export function parseConfig(given: unknown, configDir: string): ParseResult<Config> {
  if (!isRecord(given)) return { ok: false, errors: ["config must be an object"] };
  const errors: string[] = [];
  const merged = mergeChain(configChain(given, { name: "your config" }, [], errors), errors);
  const tsconfig = parseTsconfig(merged.tsconfig, errors);
  const plugins = parsePlugins(merged.plugins, errors);
  const input = merged;
  const preset = parsePreset(input.preset, errors);
  const addons = parseAddons(input.addons, plugins, errors);
  const { rules, ruleOptions } = parseRuleSettings(input.rules ?? {}, plugins, errors);
  const groups = parseGroupSettings(input.groups ?? {}, plugins, errors);
  const include = parseStringList(input.include, "include", defaults.include, errors);
  const exclude = parseStringList(input.exclude, "exclude", defaults.exclude, errors);
  const overrides = parseOverrides(input.overrides, plugins, errors);
  const ignores = parseIgnores(input.ignores, errors);
  const rollout = parseRollout(input.rollout, errors);
  const unknowns = parseUnknowns(input.unknowns, errors);
  const facts = parseFacts(input.facts, errors);
  const maxMemory = parseMaxMemory(input.maxMemory, errors);
  if (errors.length > 0 || tsconfig === undefined) return { ok: false, errors };
  return {
    ok: true,
    value: {
      tsconfig: tsconfig.map((entry) => path.resolve(configDir, entry)),
      tsconfigAsWritten: tsconfig,
      include,
      exclude,
      replacesDefaultExclude:
        input.exclude !== undefined && !defaults.exclude.every((entry) => exclude.includes(entry)),
      plugins,
      preset,
      addons,
      rules,
      groups,
      ruleOptions,
      rollout,
      configDir: path.resolve(configDir),
      facts,
      overrides,
      ignores,
      unknowns,
      maxMemory,
      warnings: [],
    },
  };
}
