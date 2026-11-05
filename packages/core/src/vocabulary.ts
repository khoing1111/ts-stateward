/*
 * The closed sets of words stateward uses, each written once. Types, config checks, the CLI's
 * questions and the generated docs all read these; none of them spells the words again.
 */

/** In the order the docs list them. */
export const RULE_TIERS = ["core", "coverage", "addon"] as const;

/** `recommended` first: it is the default. */
export const PRESETS = ["recommended", "strict"] as const;

/** What `init` offers first. A config without `preset` gets none: no rule is on until it says so. */
export const DEFAULT_PRESET: (typeof PRESETS)[number] = PRESETS[0];

const CONFIG_FILE_STEM = "stateward.config";
const CONFIG_FILE_EXTENSIONS = ["ts", "mts", "js", "mjs"] as const;

/** The config file `init` creates. */
export const DEFAULT_CONFIG_FILE = `${CONFIG_FILE_STEM}.${CONFIG_FILE_EXTENSIONS[0]}`;

/** The config files `stateward` looks for, in order. */
export const CONFIG_FILE_NAMES: readonly string[] = CONFIG_FILE_EXTENSIONS.map(
  (extension) => `${CONFIG_FILE_STEM}.${extension}`,
);

/** The config file the way a message names it: `stateward.config.{ts,mts,js,mjs}`. */
export const CONFIG_FILE_PATTERN = `${CONFIG_FILE_STEM}.{${CONFIG_FILE_EXTENSIONS.join(",")}}`;

/** Words as an error message offers them: `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
export function orList(words: readonly string[]): string {
  const quoted = words.map((word) => `"${word}"`);
  const last = quoted.at(-1);
  return last === undefined || quoted.length === 1
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} or ${last}`;
}
