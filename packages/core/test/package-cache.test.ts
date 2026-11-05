import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PACKAGE_CACHE_MARKER,
  cleanPackageCache,
  dropLeastRecentlyUsed,
  limitBytes,
  packageCacheDir,
  packageCacheLimit,
  packageCacheStats,
  readPackageCache,
  statewardVersion,
  writePackageCache,
} from "../src/internal.js";
import type { PackageCacheKey } from "../src/internal.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-package-cache-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const key: PackageCacheKey = {
  name: "@scope/lib",
  version: "1.2.3",
  integrity: "abc",
  implementation: "code-1",
};

function entryFile(): string {
  return path.join(dir, "@scope", "lib@1.2.3", `${statewardVersion()}-${key.implementation}.json`);
}

describe("the global package cache", () => {
  it("is ~/.cache/stateward/packages unless STATEWARD_PACKAGE_CACHE_DIR says otherwise", () => {
    expect(packageCacheDir({})).toMatch(/[/\\]\.cache[/\\]stateward[/\\]packages$/);
    expect(packageCacheDir({ STATEWARD_PACKAGE_CACHE_DIR: dir })).toBe(dir);
  });

  it("reads back what was written, and adds to it", () => {
    expect(writePackageCache(key, new Map([["a", { throws: [] }]]), dir)).toBeUndefined();
    expect(writePackageCache(key, new Map([["b", 1]]), dir)).toBeUndefined();
    expect([...readPackageCache(key, dir)]).toEqual([
      ["a", { throws: [] }],
      ["b", 1],
    ]);
    // No temporary file is left behind.
    expect(readdirSync(path.dirname(entryFile()))).toEqual([path.basename(entryFile())]);
  });

  it("is a miss for other content or other code, and is then replaced", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    expect(readPackageCache({ ...key, integrity: "other" }, dir).size).toBe(0);
    expect(readPackageCache({ ...key, implementation: "code-2" }, dir).size).toBe(0);
    writePackageCache({ ...key, implementation: "code-2" }, new Map([["b", 2]]), dir);
    expect([...readPackageCache({ ...key, implementation: "code-2" }, dir)]).toEqual([["b", 2]]);
  });

  it("keeps each build's entry: another implementation neither reads nor replaces it", () => {
    const other = { ...key, implementation: "code-2" };
    writePackageCache(key, new Map([["a", 1]]), dir);
    writePackageCache(other, new Map([["b", 2]]), dir);
    expect([...readPackageCache(key, dir)]).toEqual([["a", 1]]);
    expect([...readPackageCache(other, dir)]).toEqual([["b", 2]]);
    expect(readdirSync(path.dirname(entryFile())).sort()).toHaveLength(2);
  });

  it("is a miss, not an error, when the entry is corrupt", () => {
    mkdirSync(path.dirname(entryFile()), { recursive: true });
    writeFileSync(entryFile(), "{ half");
    expect(readPackageCache(key, dir).size).toBe(0);
    expect(writePackageCache(key, new Map([["a", 1]]), dir)).toBeUndefined();
    expect(JSON.parse(readFileSync(entryFile(), "utf8"))).toMatchObject({ facts: { a: 1 } });
  });

  it("returns a failure to write instead of throwing", () => {
    writeFileSync(path.join(dir, "@scope"), "a file where a folder should be");
    expect(writePackageCache(key, new Map([["a", 1]]), dir)).toBeInstanceOf(Error);
  });

  it("counts its entries and bytes, and clean removes the folder and says what it held", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    writePackageCache({ ...key, name: "other" }, new Map([["a", 1]]), dir);
    const stats = packageCacheStats(dir);
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(cleanPackageCache(dir)).toEqual({ kind: "removed", stats });
    expect(packageCacheStats(dir)).toEqual({ dir, entries: 0, bytes: 0, limit: stats.limit });
    expect(existsSync(dir)).toBe(false);
  });

  it("marks the folder it creates as stateward's", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    expect(existsSync(path.join(dir, PACKAGE_CACHE_MARKER))).toBe(true);
  });

  it("clean refuses a folder with something else at its top level, and removes nothing", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    writeFileSync(path.join(dir, "notes.txt"), "someone else's file");
    const cleaned = cleanPackageCache(dir);
    expect(cleaned).toEqual({
      kind: "refused",
      dir,
      reason: "it holds `notes.txt`, which is not a package's folder of stateward's cache",
    });
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("someone else's file");
    expect(existsSync(entryFile())).toBe(true);
  });

  it("clean refuses a folder without the marker (STATEWARD_PACKAGE_CACHE_DIR set to another folder)", () => {
    mkdirSync(path.join(dir, "lib@1.0.0"), { recursive: true });
    writeFileSync(path.join(dir, "lib@1.0.0", "data.json"), "{}");
    expect(cleanPackageCache(dir)).toMatchObject({ kind: "refused", dir });
    expect(existsSync(path.join(dir, "lib@1.0.0", "data.json"))).toBe(true);
  });

  it("clean removes only stateward's entries: another file in a package's folder stays", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    writePackageCache({ ...key, name: "other" }, new Map([["a", 1]]), dir);
    const kept = path.join(dir, "other@1.2.3", "README");
    writeFileSync(kept, "kept");
    const cleaned = cleanPackageCache(dir);
    expect(cleaned).toMatchObject({ kind: "removed", stats: { dir, entries: 2 } });
    expect(readFileSync(kept, "utf8")).toBe("kept");
    expect(existsSync(entryFile())).toBe(false);
    expect(existsSync(path.join(dir, "@scope"))).toBe(false);
    expect(packageCacheStats(dir).entries).toBe(0);
  });

  it("drops what other stateward versions wrote for a package when it writes that package", () => {
    const folder = path.dirname(entryFile());
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "0.0.9.json"), "{}");
    writeFileSync(path.join(folder, "notes.json"), "not an entry");
    // Another build of this version (a suffix after it) is not another version: it stays.
    const sameVersion = path.join(folder, `${statewardVersion()}-other-build.json`);
    writeFileSync(sameVersion, "{}");
    writePackageCache(key, new Map([["a", 1]]), dir);
    expect(readdirSync(folder).sort()).toEqual(
      [path.basename(entryFile()), path.basename(sameVersion), "notes.json"].sort(),
    );
  });

  it("marks an entry used when it reads it", () => {
    writePackageCache(key, new Map([["a", 1]]), dir);
    const long = new Date(2020, 0, 1);
    utimesSync(entryFile(), long, long);
    expect(readPackageCache(key, dir).size).toBe(1);
    // Set to now, whatever the file system's time resolution: years after the time set above.
    expect(statSync(entryFile()).mtimeMs).toBeGreaterThan(new Date(2024, 0, 1).getTime());
  });

  it("keeps under its size limit, dropping the entries used longest ago, other builds of this version included", () => {
    // A folder new to this process: the limit is applied once per process and folder.
    const limited = path.join(dir, "limited");
    const fileOf = (name: string, implementation: string): string =>
      path.join(limited, `${name}@1.2.3`, `${statewardVersion()}-${implementation}.json`);
    // Four entries of 400 bytes, used in 2020, 2021, 2022 and 2023; two are builds of one package.
    const entries = [
      { file: fileOf("lib", "old-build"), year: 2020 },
      { file: fileOf("lib", "other-build"), year: 2022 },
      { file: fileOf("a-lib", "code-1"), year: 2021 },
      { file: fileOf("b-lib", "code-1"), year: 2023 },
    ];
    for (const { file, year } of entries) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "x".repeat(400));
      utimesSync(file, new Date(year, 0, 1), new Date(year, 0, 1));
    }
    try {
      vi.stubEnv("STATEWARD_PACKAGE_CACHE_MAX_MB", String(1400 / (1024 * 1024)));
      expect(packageCacheLimit()).toBe(1400);
      const written = { ...key, name: "lib", implementation: "this-build" };
      writePackageCache(written, new Map([["a", "x".repeat(200)]]), limited);
      // The entry written stays; the two used longest ago go, a build of `lib` first.
      expect(existsSync(fileOf("lib", "this-build"))).toBe(true);
      expect(entries.map(({ file }) => existsSync(file))).toEqual([false, true, false, true]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("cache size limits", () => {
  it("reads a limit in megabytes, and falls back to the default for anything else", () => {
    expect(limitBytes(undefined, 200)).toBe(200 * 1024 * 1024);
    expect(limitBytes("", 200)).toBe(200 * 1024 * 1024);
    expect(limitBytes("50", 200)).toBe(50 * 1024 * 1024);
    expect(limitBytes("0", 200)).toBe(200 * 1024 * 1024);
    expect(limitBytes("lots", 200)).toBe(200 * 1024 * 1024);
    expect(packageCacheLimit({})).toBe(200 * 1024 * 1024);
  });

  it("drops the least recently used entries until the rest fit, oldest first, never a kept one", () => {
    const files = ["a", "b", "c", "d"].map((name) => path.join(dir, name));
    for (const file of files) writeFileSync(file, "x".repeat(100));
    const [a = "", b = "", c = "", d = ""] = files;
    const entries = [
      { file: a, bytes: 100, usedMs: 1 },
      { file: b, bytes: 100, usedMs: 4 },
      { file: c, bytes: 100, usedMs: 2 },
      { file: d, bytes: 100, usedMs: 3 },
    ];
    expect(dropLeastRecentlyUsed(entries, 400)).toEqual([]);
    const removed = dropLeastRecentlyUsed(entries, 200, new Set([a]));
    expect(removed.map((entry) => entry.file)).toEqual([c, d]);
    expect(files.map((file) => existsSync(file))).toEqual([true, true, false, false]);
  });
});
