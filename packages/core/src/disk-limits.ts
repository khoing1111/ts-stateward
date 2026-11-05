import { existsSync, readdirSync, statSync, unlinkSync, utimesSync } from "node:fs";
import path from "node:path";

/**
 * Size limits for stateward's caches on disk: the results cache of a project, the
 * global cache of package facts, and `pnpm try`'s cache. Each is kept under its limit by dropping
 * the entries used longest ago; "used" is a file's modification time, which a read of an entry
 * moves to now (`markUsed`). A limit is a soft one: it is applied after a write, so a run can leave
 * the cache one entry over it, and the entry just written is never dropped.
 */

const MEGABYTE = 1024 * 1024;

/** The limit in bytes that an environment variable gives in megabytes, or `defaultMb`. */
export function limitBytes(value: string | undefined, defaultMb: number): number {
  if (value === undefined || value.trim() === "") return defaultMb * MEGABYTE;
  const megabytes = Number(value);
  return Number.isFinite(megabytes) && megabytes > 0
    ? Math.floor(megabytes * MEGABYTE)
    : defaultMb * MEGABYTE;
}

/** Marks an entry as used now (its modification time); a failure only makes it look older. */
export function markUsed(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch {
    // Read-only or removed meanwhile: the entry is only dropped sooner.
  }
}

/** One entry of a cache: a file, its size and when it was last used. */
export type CacheEntry = { readonly file: string; readonly bytes: number; readonly usedMs: number };

/** The files under `dir` (recursively) that `isEntry` accepts, with their sizes; none when it cannot be read. */
export function cacheEntries(dir: string, isEntry: (name: string) => boolean): CacheEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  const found: CacheEntry[] = [];
  for (const name of names) {
    if (!isEntry(path.basename(name))) continue;
    const file = path.join(dir, name);
    try {
      const stats = statSync(file);
      if (stats.isFile()) found.push({ file, bytes: stats.size, usedMs: stats.mtimeMs });
    } catch {
      // Removed meanwhile by another process.
    }
  }
  return found;
}

/**
 * Removes the entries used longest ago until the rest fit in `limit` bytes, never one in `keep`.
 * Returns what it removed; an entry another process removed first is not listed, but no longer
 * counts toward the total.
 */
export function dropLeastRecentlyUsed(
  entries: readonly CacheEntry[],
  limit: number,
  keep: ReadonlySet<string> = new Set(),
): CacheEntry[] {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= limit) return [];
  const removed: CacheEntry[] = [];
  // Oldest first; equal times by name, so two runs choose the same.
  const order = [...entries].sort(
    (a, b) => a.usedMs - b.usedMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  for (const entry of order) {
    if (total <= limit) break;
    if (keep.has(entry.file)) continue;
    try {
      unlinkSync(entry.file);
      removed.push(entry);
      total -= entry.bytes;
    } catch {
      // Gone already (another process pruned it): it no longer counts. Any other failure keeps it.
      if (!existsSync(entry.file)) total -= entry.bytes;
    }
  }
  return removed;
}
