import type {
  FactSource,
  LibraryUse,
  PackageCacheStats,
  ResultsCacheStats,
} from "@stateward/core/internal";

/**
 * `stateward deps`: per package the project
 * calls, its version, how its facts are known, how many of the functions called are mapped, and
 * why the rest is unknown, so the developer sees where a config entry would help.
 */

/** In order of trust, as a package with facts from several sources lists them. */
const SOURCES: readonly FactSource[] = ["config", "declared", "inferred", "unknown"];

/** At most this many unknown functions are named per package; the rest are counted. */
const MAX_NAMED = 3;

export type DepsRow = {
  readonly package: string;
  readonly version: string;
  /** `declared`, or `declared+inferred` when its functions are known from several sources. */
  readonly facts: string;
  readonly called: number;
  readonly mapped: number;
  readonly unknown: readonly { readonly function: string; readonly reasons: readonly string[] }[];
};

export function buildDeps(uses: readonly LibraryUse[]): readonly DepsRow[] {
  // Several plugins may report one package: its functions are joined, the first report of each kept.
  const byPackage = new Map<
    string,
    { use: LibraryUse; functions: Map<string, LibraryUse["functions"][number]> }
  >();
  for (const use of uses) {
    const key = `${use.package}\u0000${use.version}`;
    const entry = byPackage.get(key) ?? { use, functions: new Map() };
    byPackage.set(key, entry);
    for (const fn of use.functions)
      if (!entry.functions.has(fn.name)) entry.functions.set(fn.name, fn);
  }
  const rows = [...byPackage.values()].map(({ use, functions }): DepsRow => {
    const list = [...functions.values()];
    const sources = new Set(list.map((fn) => fn.source));
    const unknown = list
      .filter((fn) => fn.source === "unknown" || fn.unknown.length > 0)
      .map((fn) => ({ function: fn.name, reasons: fn.unknown }));
    return {
      package: use.package,
      version: use.version,
      facts: SOURCES.filter((source) => sources.has(source)).join("+"),
      called: list.length,
      mapped: list.length - unknown.length,
      unknown,
    };
  });
  return rows.sort((a, b) =>
    a.package !== b.package ? (a.package < b.package ? -1 : 1) : a.version < b.version ? -1 : 1,
  );
}

/** `minified; add facts in your config`, or `1: format (calls a callback)`. */
function why(row: DepsRow): string {
  if (row.unknown.length === 0) return "";
  const reasons = new Set(row.unknown.flatMap((one) => one.reasons));
  const [only] = reasons;
  if (row.mapped === 0 && reasons.size === 1 && only !== undefined) {
    return `${only}; add facts in your config`;
  }
  const named = row.unknown
    .slice(0, MAX_NAMED)
    .map((one) => `${one.function} (${one.reasons.join(", ")})`);
  const rest = row.unknown.length - named.length;
  return `${String(row.unknown.length)}: ${[...named, ...(rest > 0 ? [`and ${String(rest)} more`] : [])].join(", ")}`;
}

export function formatDepsPretty(rows: readonly DepsRow[]): string {
  if (rows.length === 0) {
    return "no package facts: the project calls no package, or no rule that reads them is on\n";
  }
  const width = (header: string, values: readonly string[]): number =>
    Math.max(header.length, ...values.map((value) => value.length)) + 2;
  const packageWidth = width(
    "package",
    rows.map((row) => row.package),
  );
  const versionWidth = width(
    "version",
    rows.map((row) => row.version),
  );
  const factsWidth = width(
    "facts",
    rows.map((row) => row.facts),
  );
  const line = (cells: readonly [string, string, string, string, string, string]): string => {
    const [name, version, facts, called, mapped, unknown] = cells;
    return `${name.padEnd(packageWidth)}${version.padEnd(versionWidth)}${facts.padEnd(factsWidth)}${called.padStart(6)}${mapped.padStart(8)}  ${unknown}`.trimEnd();
  };
  return `${[
    line(["package", "version", "facts", "called", "mapped", "unknown, and why"]),
    ...rows.map((row) =>
      line([
        row.package,
        row.version === "" ? "?" : row.version,
        row.facts,
        String(row.called),
        String(row.mapped),
        why(row),
      ]),
    ),
  ].join("\n")}\n`;
}

export function formatDepsJson(rows: readonly DepsRow[]): string {
  return JSON.stringify({ packages: rows }, null, 2);
}

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function entries(count: number): string {
  return `${String(count)} ${count === 1 ? "entry" : "entries"}`;
}

/** The size against the limit: `12.0 MB of 200.0 MB`. */
function sizeOf(bytes: number, limit: number): string {
  return `${size(bytes)} of at most ${size(limit)}`;
}

function files(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

/** `stateward cache stats`: the package cache, then the project's results cache when it has one. */
export function formatCacheStats(
  packages: PackageCacheStats,
  results: ResultsCacheStats | undefined,
): string {
  const lines = [
    `package cache: ${packages.dir}`,
    `  ${entries(packages.entries)}, ${sizeOf(packages.bytes, packages.limit)} (STATEWARD_PACKAGE_CACHE_MAX_MB)`,
    results === undefined
      ? "results cache: none for this project (it is kept in node_modules/.cache/stateward when node_modules exists, or in STATEWARD_CACHE_DIR)"
      : `results cache: ${results.dir}`,
    ...(results === undefined
      ? []
      : [
          `  ${files(results.files)}, ${sizeOf(results.bytes, results.limit)} (STATEWARD_CACHE_MAX_MB)`,
        ]),
  ];
  return `${lines.join("\n")}\n`;
}

/** `stateward cache clean`: what it removed from each cache (a refusal goes to stderr, as an error). */
export function formatCacheClean(
  removed: PackageCacheStats | undefined,
  results: ResultsCacheStats | undefined,
): string {
  const lines = [
    ...(removed === undefined
      ? []
      : [
          removed.entries === 0
            ? `the package cache is already empty: ${removed.dir}`
            : `removed the package cache ${removed.dir}: ${entries(removed.entries)}, ${size(removed.bytes)}`,
        ]),
    ...(results === undefined
      ? []
      : [
          results.files === 0
            ? `the results cache is already empty: ${results.dir}`
            : `removed the results cache ${results.dir}: ${files(results.files)}, ${size(results.bytes)}`,
        ]),
  ];
  return `${lines.join("\n")}\n`;
}
