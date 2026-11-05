import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The implementation id: a hash of the code that produces findings, so that results cached on disk
 * by one build are never read by another. The rule key (`ruleKey` in cache.ts) holds a rule's own
 * `check` and `summarize` text, but not the helpers they call, and in a clone every package is
 * 0.0.0: after `git pull && pnpm build`, a changed helper would leave old findings in the cache.
 *
 * The id hashes the contents of every JavaScript file of:
 * - `@stateward/core` (this package's `dist`);
 * - each package the config imports (the plugins, found from the config's import specifiers
 *   resolved from its folder, then up to their package.json): its `dist`, or the whole package
 *   when it has none;
 * - each local file the config imports (a file in the config's own package, or in none), and every
 *   local file it imports in turn by a relative specifier;
 * - each package such a local file imports from node_modules: its name, version and integrity;
 * with each package's name and version. Reading it costs a few milliseconds,
 * so it is computed once per config file and process.
 */

const JAVASCRIPT = /\.(?:js|mjs|cjs)$/;
/** Extensions tried, in order, for a specifier written without one or with `.js` for a `.ts`. */
const PROBED = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function sha1(text: string | Buffer): string {
  return createHash("sha1").update(text).digest("hex");
}

/** The file's contents, or undefined when it cannot be read (it cannot be loaded either). */
function readOrUndefined(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch {
    return undefined;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** The folder of the nearest package.json at or above `directory`, if any. */
function packageRootOf(directory: string): string | undefined {
  for (let dir = directory; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The file a relative or absolute specifier names, as Node or TypeScript would load it. */
function resolveFile(from: string, specifier: string): string | undefined {
  const target = path.resolve(
    from,
    specifier.startsWith("file://") ? fileURLToPath(specifier) : specifier,
  );
  const stem = target.replace(/\.(?:js|mjs|cjs|jsx)$/, "");
  const candidates = [
    target,
    ...PROBED.map((extension) => `${stem}${extension}`),
    ...PROBED.map((extension) => path.join(target, `index${extension}`)),
  ];
  const found = candidates.find(isFile);
  return found === undefined ? undefined : real(found);
}

/** The folder of a bare specifier's package (`@scope/name/sub` is `@scope/name`), from `from` up. */
function resolvePackage(from: string, specifier: string): string | undefined {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (name === undefined || name === "") return undefined;
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return real(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

function specifiersOf(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isPath(specifier: string): boolean {
  return isRelative(specifier) || path.isAbsolute(specifier) || specifier.startsWith("file://");
}

/** Every JavaScript file under `dir`, but not in node_modules, as sorted relative paths. */
function javascriptFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => JAVASCRIPT.test(entry) && !entry.split(path.sep).includes("node_modules"))
    .sort();
}

/** The parsed JSON file, or undefined when it is missing or not JSON. */
function jsonOf(file: string): unknown {
  const text = readOrUndefined(file)?.toString("utf8");
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A string field of a JSON object, `?` when it is missing. */
function stringField(parsed: unknown, key: string): string {
  if (typeof parsed !== "object" || parsed === null) return "?";
  const value: unknown = Reflect.get(parsed, key);
  return typeof value === "string" ? value : "?";
}

function versionLine(root: string): string {
  const manifest = jsonOf(path.join(root, "package.json"));
  return `${stringField(manifest, "name")}@${stringField(manifest, "version")}`;
}

/**
 * The integrity the package manager recorded for an installed package, `?` when there is none:
 * npm's `node_modules/.package-lock.json` entry, or the `_integrity` field older npm wrote. Two
 * builds with the same version number (a patched or locally linked copy) then differ too.
 */
function integrityOf(root: string): string {
  const own = stringField(jsonOf(path.join(root, "package.json")), "_integrity");
  if (own !== "?") return own;
  const name = stringField(jsonOf(path.join(root, "package.json")), "name");
  for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
    if (path.basename(dir) === "node_modules") {
      const lock = jsonOf(path.join(dir, ".package-lock.json"));
      const entries: unknown =
        typeof lock === "object" && lock !== null ? Reflect.get(lock, "packages") : undefined;
      const entry: unknown =
        typeof entries === "object" && entries !== null
          ? Reflect.get(entries, `node_modules/${name}`)
          : undefined;
      return stringField(entry, "integrity");
    }
    if (path.dirname(dir) === dir) return "?";
  }
}

/** A package's name, version and every JavaScript file of its `dist` (or of the package). */
function packageHash(root: string): string {
  const dist = path.join(root, "dist");
  const base = existsSync(dist) ? dist : root;
  const hash = createHash("sha1").update(versionLine(root));
  for (const file of javascriptFiles(base)) {
    hash.update(`\n${file}\n`);
    hash.update(readOrUndefined(path.join(base, file)) ?? "?");
  }
  return hash.digest("hex");
}

type ConfigCode = {
  /** The packages whose code the config loads, real paths of their roots (core's included). */
  packages: Set<string>;
  /** Each local file the config imports, directly or through another local file, with its hash. */
  localFiles: Map<string, string>;
  /**
   * The packages a local file imports from node_modules (`typescript` in a team rule), real paths
   * of their roots. Hashed by name, version and integrity, not by code: a rule's behaviour changes
   * when the package is swapped for another version, and reading all of TypeScript would be slow.
   */
  dependencies: Set<string>;
  unresolved: Set<string>;
};

/** What a config loads: its packages and local files (see the top of this file). */
function configCode(configFile: string): ConfigCode {
  const own = packageRootOf(path.dirname(configFile));
  const packages = new Set<string>();
  const localFiles = new Map<string, string>();
  const dependencies = new Set<string>();
  const unresolved = new Set<string>();

  const coreRoot = packageRootOf(path.dirname(fileURLToPath(import.meta.url)));
  if (coreRoot !== undefined) packages.add(real(coreRoot));

  const visitLocal = (file: string): void => {
    if (localFiles.has(file)) return;
    const content = readOrUndefined(file);
    localFiles.set(file, content === undefined ? "?" : sha1(content));
    if (content === undefined) return;
    for (const specifier of specifiersOf(content.toString("utf8"))) {
      if (isRelative(specifier)) {
        follow(path.dirname(file), specifier);
      } else if (!isBuiltin(specifier) && !isPath(specifier)) {
        const root = resolvePackage(path.dirname(file), specifier);
        if (root === undefined) unresolved.add(`${path.dirname(file)}\u0000${specifier}`);
        else dependencies.add(root);
      }
    }
  };

  /** A path specifier leads to a local file, or into a package whose code is hashed whole. */
  function follow(from: string, specifier: string): void {
    const file = resolveFile(from, specifier);
    if (file === undefined) {
      unresolved.add(`${from}\u0000${specifier}`);
      return;
    }
    const root = packageRootOf(path.dirname(file));
    if (root === undefined || (own !== undefined && real(root) === real(own))) {
      visitLocal(file);
    } else {
      packages.add(real(root));
    }
  }

  const configDir = path.dirname(configFile);
  const configText = readOrUndefined(configFile)?.toString("utf8") ?? "";
  for (const specifier of specifiersOf(configText)) {
    if (isBuiltin(specifier)) continue;
    if (isPath(specifier)) {
      follow(configDir, specifier);
      continue;
    }
    const root = resolvePackage(configDir, specifier);
    if (root === undefined) unresolved.add(`${configDir}\u0000${specifier}`);
    else packages.add(root);
  }

  return { packages, localFiles, dependencies, unresolved };
}

/** The id of the code a config loads; see the top of this file. Not memoized: `implementationId` is. */
export function computeImplementationId(configFile: string): string {
  const { packages, localFiles, dependencies, unresolved } = configCode(configFile);
  const parts = [
    ...[...packages].sort().map((root) => `package ${root} ${packageHash(root)}`),
    ...[...dependencies]
      .filter((root) => !packages.has(root))
      .sort()
      .map((root) => `dependency ${root} ${versionLine(root)} ${integrityOf(root)}`),
    ...[...localFiles]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, hash]) => `file ${file} ${hash}`),
    ...[...unresolved].sort().map((specifier) => `unresolved ${specifier}`),
  ];
  return sha1(parts.join("\n"));
}

/**
 * The local files the config imports, directly or through another local file (the ones its
 * implementation id hashes), sorted: the language server reloads the config when one changes.
 */
export function configLocalImports(configFile: string): readonly string[] {
  return [...configCode(configFile).localFiles.keys()].sort();
}

/** Whether a specifier loads the `typescript` package itself or one of its files. */
function isTypeScriptPackage(specifier: string): boolean {
  return specifier === "typescript" || specifier.startsWith("typescript/");
}

/**
 * One warning for each local file the config loads that imports its own `typescript` instead of
 * `@stateward/core/typescript`. stateward parses the code with core's TypeScript; another copy
 * numbers its syntax kinds differently (5.8 and 6.0 do), so its `ts.isTypeAliasDeclaration` is
 * false for every node and the rule reports nothing.
 */
export function foreignTypeScriptWarnings(configFile: string): readonly string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const coreRoot = resolvePackage(here, "typescript");
  const configDir = path.dirname(configFile);
  const warnings: string[] = [];
  for (const file of configLocalImports(configFile)) {
    const text = readOrUndefined(file)?.toString("utf8") ?? "";
    if (!specifiersOf(text).some(isTypeScriptPackage)) continue;
    const root = resolvePackage(path.dirname(file), "typescript");
    // Not installed: loading the file fails with its own message.
    if (root === undefined) continue;
    // Bundled into the editor extension, core has no folder of its own: compare versions.
    const same =
      coreRoot === undefined ? versionLine(root) === `typescript@${ts.version}` : root === coreRoot;
    if (same) continue;
    const version = stringField(jsonOf(path.join(root, "package.json")), "version");
    const shortVersion = /^\d+\.\d+/.exec(version)?.[0] ?? version;
    const shown = path.relative(configDir, file).split(path.sep).join("/");
    warnings.push(
      `\`${shown}\` imports the app's TypeScript ${shortVersion}; use \`@stateward/core/typescript\`, or it may see nothing`,
    );
  }
  return warnings;
}

const ids = new Map<string, string>();

/** `computeImplementationId`, once per config file in this process: the code loaded does not change under it. */
export function implementationId(configFile: string): string {
  let id = ids.get(configFile);
  if (id === undefined) {
    id = computeImplementationId(configFile);
    ids.set(configFile, id);
  }
  return id;
}

const codeIds = new Map<string, string>();

/**
 * The id of the code of the package `moduleUrl` belongs to, with core's (as `computeImplementationId`
 * hashes them): what a plugin computed and cached outside a project (the library facts cache) is
 * read back only by the same code. Once per package and process.
 */
export function packageCodeId(moduleUrl: string): string {
  const root = packageRootOf(path.dirname(fileURLToPath(moduleUrl)));
  const key = root ?? moduleUrl;
  let id = codeIds.get(key);
  if (id === undefined) {
    const coreRoot = packageRootOf(path.dirname(fileURLToPath(import.meta.url)));
    id = sha1(
      [coreRoot, root].map((one) => (one === undefined ? "?" : packageHash(real(one)))).join("\n"),
    );
    codeIds.set(key, id);
  }
  return id;
}
