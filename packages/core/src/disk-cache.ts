import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { emptyCache, parseSnapshot, toSnapshot } from "./cache.js";
import type { ResultCache } from "./cache.js";
import { cacheEntries, dropLeastRecentlyUsed, limitBytes, markUsed } from "./disk-limits.js";
import { implementationId } from "./implementation.js";
import { statewardVersion } from "./package-cache.js";

/**
 * The results of earlier runs on disk, read and written by the CLI (`stateward check`) and the
 * language server alike: one JSON file per project and implementation in the cache folder, keyed
 * inside by each file's dependency fingerprint and each rule's key, so either may reuse what the
 * other wrote. A missing, unreadable or broken file is an empty cache (a cold run), never "no
 * findings"; it is written to a temporary file in the same folder and renamed over the old one, so
 * a reader (or another writer) never sees half of it: the last whole write wins.
 */

/** Where `stateward check` and the language server keep their cache, unless STATEWARD_CACHE_DIR says otherwise. */
export const CACHE_SUBDIR = path.join("node_modules", ".cache", "stateward");

/** The cache folder for a project: STATEWARD_CACHE_DIR, else node_modules/.cache/stateward when node_modules exists. */
export function defaultCacheDir(
  project: string,
  env: { STATEWARD_CACHE_DIR?: string | undefined },
): string | undefined {
  const override = env.STATEWARD_CACHE_DIR;
  if (override !== undefined && override !== "") return path.resolve(project, override);
  return existsSync(path.join(project, "node_modules"))
    ? path.join(project, CACHE_SUBDIR)
    : undefined;
}

/** The results cache's size limit unless STATEWARD_CACHE_MAX_MB sets another. */
export const RESULTS_CACHE_DEFAULT_MB = 200;

/** The size limit of a results cache folder in bytes: STATEWARD_CACHE_MAX_MB, else 200 MB. */
export function resultsCacheLimit(env: { STATEWARD_CACHE_MAX_MB?: string | undefined }): number {
  return limitBytes(env.STATEWARD_CACHE_MAX_MB, RESULTS_CACHE_DEFAULT_MB);
}

/** A results file of the folder: one per project (`check-<key>.json`). */
const RESULTS_FILE = /^check-[0-9a-f]+\.json$/;

/** A temporary file a writer left (it died between writing and renaming). */
const TEMPORARY_FILE = /^check-[0-9a-f]+\.json\..*\.tmp$/;

/** Error codes of a rename that Windows refuses while another process has the target open. */
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Waits in the pauses between rename tries (10, 20, 40, 80 ms). */
const RENAME_WAITS_MS = [10, 20, 40, 80];

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Renames, trying again after a short wait while the target is busy (EPERM, EBUSY, EACCES); other errors throw at once. */
function renameWithRetry(
  rename: (from: string, to: string) => void,
  from: string,
  to: string,
  wait: (ms: number) => void,
): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
      const pause = RENAME_WAITS_MS[attempt];
      if (pause === undefined || typeof code !== "string" || !BUSY_CODES.has(code)) throw error;
      wait(pause);
    }
  }
}

export type DiskCache = {
  readonly cache: ResultCache;
  /** Writes the cache if it changed since it was read or last saved; a failure to write is returned, not thrown. */
  save(): Error | undefined;
};

/**
 * Opens the cache of `project` (an absolute folder) in `dir`. A cache written by other code (another
 * stateward version, or another build of core or of a plugin the config loads: `implementationId`)
 * is not read: a rule's helper may have changed, so its findings may have. Each implementation has
 * its own file, so two that check one project (the CLI, and an editor's server bundled with another
 * build of core) do not replace each other's results; the folder's limit drops the one unused longest.
 */
export function openDiskCache(
  dir: string,
  project: string,
  configFile: string,
  /** The folder's size limit in bytes (`resultsCacheLimit`); applied after each save. */
  limit = resultsCacheLimit({}),
  /**
   * The implementation id of the code that runs the rules: by default `implementationId`, computed
   * once per process; the language server, which loads a changed config again, computes it anew.
   */
  implementation = implementationId(configFile),
  /** Replaced by tests only: the rename and the wait between tries. */
  io: { rename?: (from: string, to: string) => void; wait?: (ms: number) => void } = {},
): DiskCache {
  const key = createHash("sha1").update(`${project}\n${implementation}`).digest("hex").slice(0, 16);
  const file = path.join(dir, `check-${key}.json`);
  const version = statewardVersion();
  const cache = readCache(file, { version, implementation, project });
  // Used now: when the folder is over its limit, the files used longest ago go first.
  if (cache.files.size > 0) markUsed(file);
  return {
    cache,
    save() {
      if (!cache.changed) return undefined;
      const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          temporary,
          JSON.stringify({
            stateward: version,
            implementation,
            project,
            snapshot: toSnapshot(cache),
          }),
        );
        renameWithRetry(io.rename ?? renameSync, temporary, file, io.wait ?? sleep);
        // Saved: a later save (after fixes were tried) writes only what changes after this one.
        cache.changed = false;
        pruneResults(dir, file, version, limit);
        return undefined;
      } catch (error) {
        rmSync(temporary, { force: true });
        return error instanceof Error ? error : new Error(String(error));
      }
    },
  };
}

type Written = { version: string; implementation: string; project: string };

function readCache(file: string, expected: Written): ResultCache {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Missing, unreadable or not JSON: a cold run.
    return emptyCache();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyCache();
  if (
    Reflect.get(parsed, "stateward") !== expected.version ||
    Reflect.get(parsed, "implementation") !== expected.implementation ||
    Reflect.get(parsed, "project") !== expected.project
  ) {
    return emptyCache();
  }
  return parseSnapshot(Reflect.get(parsed, "snapshot"));
}

/** The stateward version a results file was written by, read from its first bytes; undefined if unreadable. */
function writtenBy(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const head = Buffer.alloc(200);
    const read = readSync(fd, head, 0, head.length, 0);
    // `save` writes `{"stateward":"<version>",…` first.
    return /^\{"stateward":"([^"]*)"/.exec(head.subarray(0, read).toString("utf8"))?.[1];
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * After saving `file`: the results files another stateward version wrote go (no version reads
 * another's; a shared STATEWARD_CACHE_DIR holds other projects'), then the folder is brought under
 * `limit` by dropping the files used longest ago, never `file`. A failure only leaves it larger.
 */
function pruneResults(dir: string, file: string, version: string, limit: number): void {
  const entries = cacheEntries(dir, (name) => RESULTS_FILE.test(name)).filter(
    (entry) => path.dirname(entry.file) === dir,
  );
  const current = entries.filter((entry) => {
    if (entry.file === file) return true;
    const by = writtenBy(entry.file);
    if (by === undefined || by === version) return true;
    try {
      unlinkSync(entry.file);
      return false;
    } catch {
      return true;
    }
  });
  dropLeastRecentlyUsed(current, limit, new Set([file]));
}

/** What a results cache folder holds: its files (one per project) and their bytes. */
export type ResultsCacheStats = {
  readonly dir: string;
  readonly files: number;
  readonly bytes: number;
  readonly limit: number;
};

function resultsFiles(dir: string): { file: string; bytes: number }[] {
  return cacheEntries(dir, (name) => RESULTS_FILE.test(name) || TEMPORARY_FILE.test(name)).filter(
    (entry) => path.dirname(entry.file) === dir,
  );
}

export function resultsCacheStats(dir: string, limit: number): ResultsCacheStats {
  const files = resultsFiles(dir).filter((entry) => entry.file.endsWith(".json"));
  return {
    dir,
    files: files.length,
    bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    limit,
  };
}

/**
 * Removes the results files of the folder (every project's, and temporary files a writer left),
 * then the folder if that left it empty. Anything else in it stays.
 */
export function cleanResultsCache(dir: string, limit: number): ResultsCacheStats {
  const before = resultsCacheStats(dir, limit);
  for (const entry of resultsFiles(dir)) {
    try {
      unlinkSync(entry.file);
    } catch {
      // Removed meanwhile by another process.
    }
  }
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Missing already, or not empty: it stays.
  }
  return before;
}
