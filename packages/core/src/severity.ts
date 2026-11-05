import { matchingOverrides } from "./overrides.js";
import type { Config, ConfigOverride, Plugin, RuleInfo, RuleSetting } from "./types.js";

/** The settings of one layer: the config itself, or one `overrides` entry. */
type Layer = Pick<Config, "addons" | "rules" | "groups"> & { preset?: Config["preset"] };

/** What a layer says about a rule, and whether it was named (`rules`, `groups`) or only a default. */
type Said = { setting: RuleSetting; named: boolean };

/**
 * What a layer says about one rule, or undefined when it says nothing. Inside a layer the order is
 * the one below: the preset's tier default, then the add-ons the
 * layer turns on, then `groups`, then `rules` (the last one that speaks wins). The config itself
 * always speaks: an add-on that is not listed is off. An override speaks only about what it names.
 */
function layerSetting(
  layer: Layer,
  base: boolean,
  pluginName: string,
  key: string,
  meta: RuleInfo,
): Said | undefined {
  const explicit = layer.rules[`${pluginName}/${key}`];
  if (explicit !== undefined) return { setting: explicit, named: true };
  const grouped = layer.groups[`${pluginName}/${meta.group}`];
  if (grouped !== undefined) return { setting: grouped, named: true };
  if (meta.tier === "addon") {
    if (!layer.addons.includes(`${pluginName}/${meta.addon ?? ""}`)) {
      return base ? { setting: "off", named: false } : undefined;
    }
    return { setting: heuristicCap(meta.defaultSeverity, meta), named: false };
  }
  if (layer.preset === undefined) return undefined;
  return { setting: heuristicCap(tierSeverity(layer.preset, meta), meta), named: false };
}

/** A heuristic rule's default is at most a warning; settings the config names are never capped. */
function heuristicCap(setting: RuleSetting, meta: RuleInfo): RuleSetting {
  return meta.heuristic === true && setting === "error" ? "warning" : setting;
}

type Settings = Pick<Config, "preset" | "addons" | "rules" | "groups"> &
  Partial<Pick<Config, "overrides" | "configDir">>;

/**
 * What the config says, then each of `applied` in order; the last layer that speaks wins. A
 * default (an override's preset or add-on) does not undo a setting some layer named: a folder
 * that is `strict` still keeps the severity you gave a rule for the whole project.
 */
export function ruleSettingWith(
  config: Settings,
  applied: readonly ConfigOverride[],
  pluginName: string,
  key: string,
  meta: RuleInfo,
): RuleSetting {
  let said = layerSetting(config, true, pluginName, key, meta) ?? { setting: "off", named: false };
  for (const override of applied) {
    const next = layerSetting(override, false, pluginName, key, meta);
    if (next !== undefined && (next.named || !said.named)) said = next;
  }
  return said.setting;
}

/**
 * What a rule runs at under `config`, or "off". The one place the order is decided: the config's own preset, add-ons, groups and rules, then each of the
 * `overrides` that match `file`, in order, each by the same steps. Without a `file` only the
 * config's own settings count. Settings the config names are never capped.
 */
export function ruleSetting(
  config: Settings,
  pluginName: string,
  key: string,
  meta: RuleInfo,
  file?: string,
): RuleSetting {
  const applied =
    file === undefined ? [] : appliedOverrides(config, matchingOverrides(config, file));
  return ruleSettingWith(config, applied, pluginName, key, meta);
}

/** The overrides at these positions of `config.overrides`, in that order. */
export function appliedOverrides(
  config: Partial<Pick<Config, "overrides">>,
  matched: readonly number[],
): readonly ConfigOverride[] {
  return matched.flatMap((index) => config.overrides?.[index] ?? []);
}

/**
 * Whether a rule runs somewhere: on in the config itself, or in a file some override reaches. A
 * rule that is off everywhere is never loaded; one that is on in a few folders runs everywhere it
 * can and is filtered by file (a project rule needs every file's summary).
 */
export function ruleIsOn(
  config: Settings,
  pluginName: string,
  key: string,
  meta: RuleInfo,
): boolean {
  if (ruleSettingWith(config, [], pluginName, key, meta) !== "off") return true;
  return (config.overrides ?? []).some(
    (override) => ruleSettingWith(config, [override], pluginName, key, meta) !== "off",
  );
}

/** The add-ons in force for the files `applied` reach: the config's, and each override's. */
export function addonsWith(
  config: Pick<Config, "addons">,
  applied: readonly ConfigOverride[],
): readonly string[] {
  return applied.length === 0
    ? config.addons
    : [...new Set([...config.addons, ...applied.flatMap((override) => override.addons)])];
}

function tierSeverity(preset: Config["preset"], meta: RuleInfo): RuleSetting {
  switch (meta.tier) {
    case "core":
    case "addon":
      return meta.defaultSeverity;
    case "coverage":
      return preset === "strict" ? "error" : "info";
    default: {
      const unreachable: never = meta.tier;
      return unreachable;
    }
  }
}

/** Every add-on the plugins offer, as "<plugin>/<addon>", sorted and without repeats. */
export function addonNames(plugins: readonly Plugin[]): readonly string[] {
  const names = new Set<string>();
  for (const plugin of plugins) {
    for (const rule of Object.values(plugin.rules)) {
      if (rule.meta.tier === "addon" && rule.meta.addon !== undefined) {
        names.add(`${plugin.name}/${rule.meta.addon}`);
      }
      for (const name of rule.meta.widenedBy ?? []) names.add(`${plugin.name}/${name}`);
    }
  }
  return [...names].sort();
}

/** Every rule id the plugins offer, as "<plugin>/<rule key>", in plugin order. */
export function ruleIds(plugins: readonly Plugin[]): readonly string[] {
  return plugins.flatMap((plugin) =>
    Object.keys(plugin.rules).map((key) => `${plugin.name}/${key}`),
  );
}

/** Every group the plugins offer, as "<plugin>/<group>", in the order of the first rule of each. */
export function groupIds(plugins: readonly Plugin[]): readonly string[] {
  const ids = new Set<string>();
  for (const plugin of plugins) {
    for (const rule of Object.values(plugin.rules)) ids.add(`${plugin.name}/${rule.meta.group}`);
  }
  return [...ids];
}
