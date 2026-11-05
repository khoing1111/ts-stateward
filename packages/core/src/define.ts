import type {
  EditorContributions,
  FileRule,
  Json,
  NoOptions,
  OptionSpecs,
  PluginOf,
  ProjectRule,
  PluginRule,
  Rule,
} from "./types.js";

/**
 * Identity helpers: they return what they are given, so TypeScript can infer the rule's options
 * from `meta.options` and type `ctx.options` in `check`. A rule without `meta.options` takes no
 * options, and a config that gives it some does not compile.
 */
export function defineRule<S extends OptionSpecs = NoOptions, G extends string = string>(
  rule: FileRule<S, G>,
): FileRule<S, G>;
export function defineRule<
  Summary extends Json,
  S extends OptionSpecs = NoOptions,
  G extends string = string,
>(rule: ProjectRule<Summary, S, G>): ProjectRule<Summary, S, G>;
export function defineRule(rule: Rule): Rule {
  return rule;
}

/** Keeps the plugin's name, rule keys and rule groups as literal types, so config rule and group ids can be completed. */
export function definePlugin<
  const N extends string,
  const R extends Readonly<Record<string, PluginRule>>,
>(plugin: {
  name: N;
  description: string;
  rules: R;
  editor?: EditorContributions;
}): PluginOf<N, R> {
  return plugin;
}
