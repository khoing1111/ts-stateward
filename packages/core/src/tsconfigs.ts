import { readdirSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

/** A `tsconfig` entry with a glob character in it; any other entry names one file. */
export function isGlob(entry: string): boolean {
  return picomatch.scan(entry.split(path.sep).join("/")).isGlob;
}

/** Folders a tsconfig glob never looks into: installed packages and hidden folders (`.git`). */
function skipped(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

/**
 * The files under `base` whose path matches `pattern` (both absolute, forward slashes), sorted.
 * Without `**` the walk stops at the pattern's depth: a glob one folder deep reads only the folder
 * it starts in and the folders right inside it, never a whole repository.
 */
function matching(base: string, pattern: string): string[] {
  const isMatch = picomatch(pattern, { dot: false });
  const deep = pattern.includes("**");
  const depth = pattern.slice(base.length).split("/").filter(Boolean).length;
  const found: string[] = [];
  const walk = (dir: string, level: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A folder that cannot be read lists nothing; a glob matching nothing is reported by the caller.
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skipped(entry.name) && (deep || level + 1 < depth)) walk(full, level + 1);
      } else if (isMatch(full)) {
        found.push(full);
      }
    }
  };
  walk(base, 0);
  return found.sort();
}

/**
 * The tsconfig files `entries` name, in their order: a path as it is, a glob as the files it matches
 * (sorted, so the order never depends on the file system), each file once. A glob that matches no
 * file is returned in `unmatched`: it is most likely a typo.
 */
export function expandTsconfigs(entries: readonly string[]): {
  files: readonly string[];
  unmatched: readonly string[];
} {
  const files: string[] = [];
  const seen = new Set<string>();
  const unmatched: string[] = [];
  const add = (file: string): void => {
    const normal = path.resolve(file);
    if (seen.has(normal)) return;
    seen.add(normal);
    files.push(normal);
  };
  for (const entry of entries) {
    if (!isGlob(entry)) {
      add(entry);
      continue;
    }
    const pattern = entry.split(path.sep).join("/");
    const { base } = picomatch.scan(pattern);
    const found = matching(base === "" ? "/" : base, pattern);
    if (found.length === 0) unmatched.push(entry);
    for (const file of found) add(file);
  }
  return { files, unmatched };
}
