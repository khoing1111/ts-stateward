import { isDeepStrictEqual } from "node:util";
import { ruleIsOn } from "./severity.js";
import type {
  Config,
  LazyRule,
  NoOptions,
  OptionSpecs,
  Plugin,
  PluginRule,
  Rule,
  RuleDeclaration,
} from "./types.js";

/*
 * Lazy rule modules. A pack declares its rules' metadata up front
 * (a generated `rules.meta.ts`) and gives each rule a loader; core loads the rules that are on
 * before a check (`loadRules`), so a rule that is off never loads, nor what only it imports.
 */

/**
 * A module imported once, the first time it is asked for, and then known synchronously. Built at
 * the top of a pack's module, so every instance of the pack (`unions()` called twice) shares it.
 */
export type ModuleLoader<M> = {
  load(): Promise<M>;
  /** The module once `load` has finished, else undefined. */
  loaded(): M | undefined;
};

/** Wraps a dynamic `import()`. A failed import is not kept: the next `load` tries again. */
export function moduleLoader<M>(importModule: () => Promise<M>): ModuleLoader<M> {
  let pending: Promise<M> | undefined;
  let module: { value: M } | undefined;
  return {
    load() {
      pending ??= importModule().then(
        (value) => {
          module = { value };
          return value;
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
      return pending;
    },
    loaded: () => module?.value,
  };
}

/**
 * A rule whose code is in `module`: `declared` is what the pack says about it up front (its entry
 * in the pack's generated `rules.meta.ts`), `pick` takes the rule out of the loaded module (and
 * may build it from the pack's options). Core checks, when it loads the rule, that the module's
 * rule says the same as `declared`.
 */
export function lazyRule<M, S extends OptionSpecs = NoOptions, G extends string = string>(
  declared: RuleDeclaration<S, G>,
  module: ModuleLoader<M>,
  pick: (module: M) => Rule,
): LazyRule<S, G> {
  let rule: Rule | undefined;
  const from = (value: M): Rule => (rule ??= pick(value));
  return {
    kind: "lazy",
    ruleKind: declared.kind,
    meta: declared.meta,
    load: async () => from(await module.load()),
    loaded() {
      const value = module.loaded();
      return value === undefined ? undefined : from(value);
    },
  };
}

/** A rule that is on was not loaded before the check: the caller skipped `loadRules`, a bug. */
export class RuleNotLoadedError extends Error {
  constructor(ruleId: string) {
    super(
      `${ruleId} is on but its code is not loaded; call loadRules(config) (loadConfigFile does) before checking`,
    );
    this.name = "RuleNotLoadedError";
  }
}

/**
 * A pack's rule module says something other than what the pack declared up front: its generated
 * `rules.meta.ts` is out of date, a bug of the pack.
 */
export class RuleDeclarationError extends Error {
  constructor(ruleId: string, what: string) {
    super(
      `${ruleId}: the rule's module and what its pack declares up front differ (${what}); regenerate the pack's rules.meta.ts (pnpm run docs)`,
    );
    this.name = "RuleDeclarationError";
  }
}

/** A rule's module could not be imported (a broken install). */
export class RuleLoadError extends Error {
  constructor(ruleId: string, reason: string) {
    super(`${ruleId}: its code could not be loaded: ${reason}`);
    this.name = "RuleLoadError";
  }
}

/** Rules already compared with their declaration. */
const verified = new WeakSet<Rule>();

function verify(ruleId: string, declared: LazyRule, rule: Rule): Rule {
  if (verified.has(rule)) return rule;
  if (rule.kind !== declared.ruleKind) {
    throw new RuleDeclarationError(ruleId, `kind "${rule.kind}", declared "${declared.ruleKind}"`);
  }
  const keys = [...new Set([...Object.keys(rule.meta), ...Object.keys(declared.meta)])]
    .filter((key) => key !== "explain")
    .sort();
  const before = new Map<string, unknown>(Object.entries(declared.meta));
  const after = new Map<string, unknown>(Object.entries(rule.meta));
  const differs = keys.filter((key) => !isDeepStrictEqual(before.get(key), after.get(key)));
  if (differs.length > 0) throw new RuleDeclarationError(ruleId, `meta.${differs.join(", meta.")}`);
  verified.add(rule);
  return rule;
}

/** The code of a plugin's rule; a lazy rule must already be loaded (`loadRules`). */
export function codeOf(ruleId: string, rule: PluginRule): Rule {
  if (rule.kind !== "lazy") return rule;
  const loaded = rule.loaded();
  if (loaded === undefined) throw new RuleNotLoadedError(ruleId);
  return verify(ruleId, rule, loaded);
}

/** Loads one lazy rule and checks it against its declaration. */
export async function loadRule(ruleId: string, rule: PluginRule): Promise<Rule> {
  if (rule.kind !== "lazy") return rule;
  let loaded: Rule;
  try {
    loaded = await rule.load();
  } catch (error) {
    throw new RuleLoadError(ruleId, error instanceof Error ? error.message : String(error));
  }
  return verify(ruleId, rule, loaded);
}

type Settings = Pick<Config, "plugins" | "preset" | "addons" | "rules" | "groups"> &
  Partial<Pick<Config, "overrides">>;

/**
 * Loads the code of every lazy rule that is on somewhere (in the config or in an override), so a
 * check can run them. A rule that is off everywhere is not loaded. Rejects with a `RuleLoadError`
 * or a `RuleDeclarationError`.
 */
export async function loadRules(config: Settings): Promise<void> {
  await Promise.all(
    config.plugins.flatMap((plugin) =>
      Object.entries(plugin.rules)
        .filter(
          ([key, rule]) => rule.kind === "lazy" && ruleIsOn(config, plugin.name, key, rule.meta),
        )
        .map(([key, rule]) => loadRule(`${plugin.name}/${key}`, rule)),
    ),
  );
}

/** Loads every rule of the plugins, on or off: for the docs and for tests. */
export async function loadAllRules(plugins: readonly Plugin[]): Promise<void> {
  await Promise.all(
    plugins.flatMap((plugin) =>
      Object.entries(plugin.rules).map(([key, rule]) => loadRule(`${plugin.name}/${key}`, rule)),
    ),
  );
}
