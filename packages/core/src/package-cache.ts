import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import type { Json } from "./types.js";
import { cacheEntries, dropLeastRecentlyUsed, limitBytes, markUsed } from "./disk-limits.js";

/**
 * The global cache of library facts: a published package
 * version does not change, so what was computed about it is shared by every project on the
 * machine, in `~/.cache/stateward/packages/<name>@<version>/<stateward version>-<implementation id>.json` (or
 * STATEWARD_PACKAGE_CACHE_DIR). An entry holds facts by key (a plugin's kind and function), so
 * facts are computed lazily, one function at a time. It is keyed inside by the package's
 * integrity (its package.json's hash) and the implementation id of the code that computed it: an
 * entry written for other content or by other code is a miss. The implementation id is in the
 * file's name too, so two builds of one version on a machine (two clones) each keep their entry
 * instead of overwriting each other's. A missing, corrupt or unreadable
 * entry is a miss, never "no facts" (workspace C35); writes go to a temporary file renamed over
 * the entry, so a reader, or a second process writing the same entry, never sees half of one.
 */

/** The cache's size limit unless STATEWARD_PACKAGE_CACHE_MAX_MB sets another (disk-limits.ts). */
export const PACKAGE_CACHE_DEFAULT_MB = 200;

/** The cache's size limit in bytes: STATEWARD_PACKAGE_CACHE_MAX_MB, else 200 MB. */
export function packageCacheLimit(
  env: { STATEWARD_PACKAGE_CACHE_MAX_MB?: string | undefined } = process.env,
): number {
  return limitBytes(env.STATEWARD_PACKAGE_CACHE_MAX_MB, PACKAGE_CACHE_DEFAULT_MB);
}

/** Bumped when the entry's shape changes. */
const FORMAT = 1;

/**
 * The file that marks a folder as stateward's package cache. `cache clean` removes nothing from
 * a folder without it: STATEWARD_PACKAGE_CACHE_DIR may name a folder that holds other things.
 */
export const PACKAGE_CACHE_MARKER = ".stateward-package-cache";

export type PackageCacheKey = {
  readonly name: string;
  readonly version: string;
  /** A hash of the package's content as installed (its package.json is enough: versions are immutable). */
  readonly integrity: string;
  /** The code that computes the facts (`packageCodeId`): another build's facts are not read. */
  readonly implementation: string;
};

/** The folder of the cache: STATEWARD_PACKAGE_CACHE_DIR, else ~/.cache/stateward/packages. */
export function packageCacheDir(
  env: { STATEWARD_PACKAGE_CACHE_DIR?: string | undefined } = process.env,
): string {
  const override = env.STATEWARD_PACKAGE_CACHE_DIR;
  if (override !== undefined && override !== "") return path.resolve(override);
  return path.join(homedir(), ".cache", "stateward", "packages");
}

let version: string | undefined;

/** The stateward version (core's): a new release reads nothing an older one wrote. */
export function statewardVersion(): string {
  if (version === undefined) {
    const read: unknown = createRequire(import.meta.url)("../package.json");
    const field: unknown =
      typeof read === "object" && read !== null ? Reflect.get(read, "version") : undefined;
    version = typeof field === "string" ? field : "unknown";
  }
  return version;
}

/** The implementation id as a file name part: any other character becomes `_`, long ids are cut. */
function fileSafe(id: string): string {
  return id.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
}

function entryFile(dir: string, key: PackageCacheKey): string {
  // A scoped name (`@scope/name`) is a folder under its scope's folder.
  return path.join(
    dir,
    `${key.name}@${key.version}`,
    `${statewardVersion()}-${fileSafe(key.implementation)}.json`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return true;
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

/** The facts of the entry, by key; empty for a missing, corrupt or mismatched entry (a miss). */
export function readPackageCache(
  key: PackageCacheKey,
  dir = packageCacheDir(),
): ReadonlyMap<string, Json> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(entryFile(dir, key), "utf8"));
  } catch {
    return new Map();
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== FORMAT ||
    parsed.name !== key.name ||
    parsed.version !== key.version ||
    parsed.integrity !== key.integrity ||
    parsed.implementation !== key.implementation ||
    !isRecord(parsed.facts)
  ) {
    return new Map();
  }
  const facts = new Map<string, Json>();
  for (const [name, value] of Object.entries(parsed.facts)) {
    if (isJson(value)) facts.set(name, value);
  }
  // Used now: the size limit drops the entries used longest ago first.
  markUsed(entryFile(dir, key));
  return facts;
}

/**
 * Adds `facts` to the entry (what another process wrote meanwhile is kept, when it is for the
 * same key), atomically. A failure to write is returned, not thrown: the facts are right, only
 * the next run computes them again.
 */
export function writePackageCache(
  key: PackageCacheKey,
  facts: ReadonlyMap<string, Json>,
  dir = packageCacheDir(),
): Error | undefined {
  const file = entryFile(dir, key);
  const merged = new Map([...readPackageCache(key, dir), ...facts]);
  const sorted = [...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const marker = path.join(dir, PACKAGE_CACHE_MARKER);
    if (!existsSync(marker)) {
      writeFileSync(
        marker,
        "stateward's cache of package facts: `stateward cache clean` empties it\n",
      );
    }
    writeFileSync(
      temporary,
      JSON.stringify({
        format: FORMAT,
        name: key.name,
        version: key.version,
        integrity: key.integrity,
        implementation: key.implementation,
        facts: Object.fromEntries(sorted),
      }),
    );
    renameSync(temporary, file);
    pruneAfterWrite(dir, file);
    return undefined;
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Its folder could not be made: there is no temporary file to remove.
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** An entry's file name: a stateward version (`0.1.0-beta.5.json`), whatever follows it. */
const ENTRY_NAME = /^\d+\.\d+\.\d+[^/\\]*\.json$/;

/** Whether `file` is an entry of the cache: an entry's name in a package's folder. */
function isEntryFile(file: string): boolean {
  return ENTRY_NAME.test(path.basename(file)) && isVersionFolder(path.basename(path.dirname(file)));
}

/** Whether `name`, in a package's folder, is an entry another stateward version wrote. */
function isOtherVersion(name: string, version: string): boolean {
  if (!ENTRY_NAME.test(name)) return false;
  const stem = name.slice(0, -".json".length);
  // The entry of this version, alone or with a suffix after it (another build's).
  return !(stem === version || stem.startsWith(`${version}.`) || stem.startsWith(`${version}-`));
}

/** The folders whose size this process has already brought under the limit. */
const limited = new Set<string>();

/**
 * After writing `file`: the entries other stateward versions wrote for the same package go (no
 * version reads another's), and, once per process, the cache is brought under its size limit by
 * dropping the entries used longest ago. A failure only leaves the cache larger.
 */
function pruneAfterWrite(dir: string, file: string): void {
  const version = statewardVersion();
  const folder = path.dirname(file);
  for (const name of entriesOf(folder)) {
    if (!isOtherVersion(name, version)) continue;
    try {
      unlinkSync(path.join(folder, name));
    } catch {
      // Removed meanwhile, or not ours to remove: it stays, and the size limit counts it.
    }
  }
  if (limited.has(dir)) return;
  limited.add(dir);
  dropLeastRecentlyUsed(
    cacheEntries(dir, (name) => ENTRY_NAME.test(name)).filter((entry) => isEntryFile(entry.file)),
    packageCacheLimit(),
    new Set([file]),
  );
}

/** What the cache holds: its entries (one per package version and stateward version) and bytes. */
export type PackageCacheStats = {
  readonly dir: string;
  readonly entries: number;
  readonly bytes: number;
  /** The size limit in bytes (`packageCacheLimit`). */
  readonly limit: number;
};

export function packageCacheStats(dir = packageCacheDir()): PackageCacheStats {
  let entries = 0;
  let bytes = 0;
  let names: string[];
  const limit = packageCacheLimit();
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return { dir, entries, bytes, limit };
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const stats = statSync(path.join(dir, name));
      if (!stats.isFile()) continue;
      entries += 1;
      bytes += stats.size;
    } catch {
      // Removed meanwhile (another process cleaned it): not counted.
    }
  }
  return { dir, entries, bytes, limit };
}

/** What `cache clean` did: removed stateward's entries, or refused, saying why. */
export type PackageCacheClean =
  | { readonly kind: "removed"; readonly stats: PackageCacheStats }
  | { readonly kind: "refused"; readonly dir: string; readonly reason: string };

/** `<name>@<version>`: a package's folder in the cache. */
function isVersionFolder(name: string): boolean {
  return name.lastIndexOf("@") > 0;
}

function isFolder(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/**
 * The package folders of the cache (`<name>@<version>`, `@scope/<name>@<version>`), or the first
 * top-level name that does not fit that layout.
 */
function layoutOf(dir: string): { folders: string[] } | { stranger: string } {
  const folders: string[] = [];
  for (const name of entriesOf(dir)) {
    if (name === PACKAGE_CACHE_MARKER) continue;
    const full = path.join(dir, name);
    if (!isFolder(full)) return { stranger: name };
    if (name.startsWith("@")) {
      for (const inner of entriesOf(full)) {
        if (!isVersionFolder(inner) || !isFolder(path.join(full, inner))) {
          return { stranger: `${name}/${inner}` };
        }
        folders.push(path.join(full, inner));
      }
    } else if (isVersionFolder(name)) {
      folders.push(full);
    } else {
      return { stranger: name };
    }
  }
  return { folders };
}

/** Removes a folder that is empty; one that is not stays. */
function removeIfEmpty(folder: string): void {
  if (entriesOf(folder).length > 0) return;
  try {
    rmdirSync(folder);
  } catch {
    // Removed meanwhile, or not ours to remove: it stays.
  }
}

/**
 * Removes stateward's entries from the package cache, `<name>@<version>/<stateward version>-<implementation>.json`
 * (and a temporary file a writer left), then the folders that are left empty. Anything else stays.
 * It refuses, removing nothing, when the folder lacks the marker a stateward write leaves, or
 * holds at its top level something that is not a package's folder: the folder may be another
 * tool's (STATEWARD_PACKAGE_CACHE_DIR is the user's to set).
 */
export function cleanPackageCache(dir = packageCacheDir()): PackageCacheClean {
  const before = packageCacheStats(dir);
  if (!existsSync(dir)) return { kind: "removed", stats: before };
  if (!existsSync(path.join(dir, PACKAGE_CACHE_MARKER))) {
    return {
      kind: "refused",
      dir,
      reason: `it has no ${PACKAGE_CACHE_MARKER} file, so it may not be stateward's cache (remove it yourself if it is)`,
    };
  }
  const layout = layoutOf(dir);
  if ("stranger" in layout) {
    return {
      kind: "refused",
      dir,
      reason: `it holds \`${layout.stranger}\`, which is not a package's folder of stateward's cache`,
    };
  }
  let entries = 0;
  let bytes = 0;
  for (const folder of layout.folders) {
    for (const name of entriesOf(folder)) {
      if (!name.endsWith(".json") && !name.endsWith(".tmp")) continue;
      const file = path.join(folder, name);
      try {
        const stats = statSync(file);
        if (!stats.isFile()) continue;
        unlinkSync(file);
        if (name.endsWith(".json")) {
          entries += 1;
          bytes += stats.size;
        }
      } catch {
        // Removed meanwhile by another process: not counted.
      }
    }
    removeIfEmpty(folder);
    const parent = path.dirname(folder);
    if (parent !== dir) removeIfEmpty(parent);
  }
  if (entriesOf(dir).every((name) => name === PACKAGE_CACHE_MARKER)) {
    rmSync(path.join(dir, PACKAGE_CACHE_MARKER), { force: true });
    removeIfEmpty(dir);
  }
  return { kind: "removed", stats: { dir, entries, bytes, limit: before.limit } };
}
