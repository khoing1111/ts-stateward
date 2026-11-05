import path from "node:path";
import picomatch from "picomatch";
import type { Config } from "./types.js";

type Overridden = Partial<Pick<Config, "overrides" | "configDir">>;

const compiled = new WeakMap<object, readonly ((relative: string) => boolean)[]>();
const matched = new WeakMap<object, Map<string, readonly number[]>>();

/** One matcher per override, built once per config: a run asks for every file. */
function matchersOf(config: Overridden): readonly ((relative: string) => boolean)[] {
  let found = compiled.get(config);
  if (found === undefined) {
    found = (config.overrides ?? []).map((override) =>
      picomatch([...override.files], { dot: true }),
    );
    compiled.set(config, found);
  }
  return found;
}

/**
 * The positions in `config.overrides` of the entries whose `files` match `file`, in order. The
 * globs are relative to the config's folder, so `src/legacy/**` means that folder of the project
 * whichever folder stateward runs from.
 */
export function matchingOverrides(config: Overridden, file: string): readonly number[] {
  const matchers = matchersOf(config);
  if (matchers.length === 0 || config.configDir === undefined) return [];
  let byFile = matched.get(config);
  if (byFile === undefined) {
    byFile = new Map();
    matched.set(config, byFile);
  }
  const known = byFile.get(file);
  if (known !== undefined) return known;
  const relative = path.relative(config.configDir, file).split(path.sep).join("/");
  const found = matchers.flatMap((matches, index) => (matches(relative) ? [index] : []));
  byFile.set(file, found);
  return found;
}
