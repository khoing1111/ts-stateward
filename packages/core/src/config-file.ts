import { once } from "node:events";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import { createJiti } from "jiti";
import { configLocalImports, foreignTypeScriptWarnings } from "./implementation.js";
import { parseConfig } from "./config.js";
import { renamedIdsIn } from "./renamed.js";
import { RuleDeclarationError, RuleLoadError, loadRules } from "./lazy.js";
import type { Config, ParseResult } from "./types.js";
import { CONFIG_FILE_NAMES, CONFIG_FILE_PATTERN } from "./vocabulary.js";

/** The path of the config file in `cwd`, if there is one. */
export function findConfigFile(cwd: string): string | undefined {
  return CONFIG_FILE_NAMES.map((name) => path.join(cwd, name)).find((file) => existsSync(file));
}

/**
 * One warning per other config file in the folder of `configFile`, when `configFile` is the one
 * the search picks (`CONFIG_FILE_NAMES` order): the others are never read. A config named with
 * `--config` is a choice, and gets none.
 */
export function ignoredConfigWarnings(configFile: string): readonly string[] {
  const dir = path.dirname(configFile);
  if (findConfigFile(dir) !== configFile) return [];
  const used = path.basename(configFile);
  return CONFIG_FILE_NAMES.filter((name) => name !== used && existsSync(path.join(dir, name))).map(
    (name) =>
      `\`${name}\` is ignored: \`${used}\` in the same folder is the config used; delete the one not wanted`,
  );
}

/**
 * What went wrong while loading the config file, and what to do: a package it imports that is not
 * installed, or a syntax error, each in one or two lines; any other failure keeps its own message.
 */
export function describeLoadFailure(configFile: string, reason: string): string {
  const lines = reason.split("\n").map((line) => line.trim());
  const first = lines[0] ?? reason;
  const missing = /Cannot find (?:module|package) '([^']+)'/.exec(first);
  if (missing?.[1] !== undefined) {
    const name = missing[1];
    return `could not load ${configFile}: it imports "${name}", which is not installed in this project\n  = fix: install it (for example \`npm install --save-dev ${name}\`), or remove it from the config`;
  }
  if (first.startsWith("ParseError")) {
    const place = lines.map((line) => /:(\d+:\d+)$/.exec(line)?.[1]).find((at) => at !== undefined);
    const where = place === undefined ? "" : ` at line:column ${place}`;
    const detail = first.replace(/^ParseError:\s*/, "").trim();
    return `could not load ${configFile}: syntax error${where}: ${detail}\n  = fix: correct the syntax in the config, then run the command again`;
  }
  return `could not load ${configFile}: ${reason}`;
}

/** A folder where a search for the config stops: the repository's root, or a workspace's. */
function isTopFolder(dir: string): boolean {
  if (existsSync(path.join(dir, ".git")) || existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    return true;
  }
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return typeof manifest === "object" && manifest !== null && "workspaces" in manifest;
  } catch {
    // No package.json, or one that is not JSON: not a workspace root.
    return false;
  }
}

/**
 * The nearest config file at or above `start`: the search goes up one folder at a time and stops
 * after the repository's root (a `.git`), a workspace root (`pnpm-workspace.yaml`, or a
 * `package.json` with `workspaces`) or `stopAt`, so a config of an unrelated parent folder is never
 * picked up.
 */
export function findConfigUpward(start: string, stopAt?: string): string | undefined {
  const last = stopAt === undefined ? undefined : path.resolve(stopAt);
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const found = findConfigFile(dir);
    if (found !== undefined) return found;
    if (dir === last || isTopFolder(dir) || path.dirname(dir) === dir) return undefined;
  }
}

/** Finds the config file (`CONFIG_FILE_NAMES`) in `cwd`, loads it with jiti and validates it. */
export async function loadConfig(
  cwd: string,
): Promise<ParseResult<Config & { configFile: string }>> {
  const configFile = findConfigFile(cwd);
  if (configFile === undefined) {
    return {
      ok: false,
      errors: [
        `no ${CONFIG_FILE_PATTERN} found in ${cwd}\n  = fix: run \`npx stateward init\` in your project's folder to create one (or \`--cwd <dir>\` to name the folder)`,
      ],
    };
  }
  return loadConfigFile(configFile);
}

/*
 * A config loaded again in the same process (the language server, after an edit) must see the
 * new text of the local files it imports. jiti reads TypeScript files afresh, but it hands an
 * ES module (`.mjs`, or `.js` in a `"type": "module"` package) to Node's `import()`, which keeps
 * a module per URL for the life of the process. So from the second load of a config on, a
 * resolve hook gives each of its local JavaScript imports a new URL (`?stateward-load=<n>`);
 * a CommonJS one is dropped from `require.cache`.
 */
const RELOAD_HOOKS = `
const fresh = new Map();
export function initialize({ port }) {
  port.on("message", (message) => {
    for (const url of message.urls) fresh.set(url, message.version);
    port.postMessage(true);
  });
}
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  const version = fresh.get(result.url);
  return version === undefined ? result : { ...result, url: result.url + "?stateward-load=" + version };
}
`;

const JAVASCRIPT = /\.[cm]?js$/;

/** How many times each config file was loaded in this process. */
const loads = new Map<string, number>();
let reloadPort: MessagePort | undefined | false;
let reloadVersion = 0;

/** The port to the resolve hook, registered on first use; false when this Node cannot register one. */
function hookPort(): MessagePort | false {
  if (reloadPort !== undefined) return reloadPort;
  // `module.register` came in Node 20.6.
  if (!("register" in nodeModule)) return (reloadPort = false);
  const { port1, port2 } = new MessageChannel();
  nodeModule.register(`data:text/javascript,${encodeURIComponent(RELOAD_HOOKS)}`, {
    data: { port: port2 },
    transferList: [port2],
  });
  port1.unref();
  reloadPort = port1;
  return port1;
}

/**
 * Whether a config loaded again reads the new text of the local JavaScript files it imports
 * (`.mjs` too); false on a Node without `module.register`, where only TypeScript ones reload.
 */
export function reloadsLocalImports(): boolean {
  return "register" in nodeModule;
}

function realOrSelf(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** Before a second or later load: the config's local JavaScript imports are imported afresh. */
async function forgetLocalImports(configFile: string): Promise<void> {
  const files = configLocalImports(configFile)
    .filter((file) => JAVASCRIPT.test(file))
    .map(realOrSelf);
  if (files.length === 0) return;
  const cache = nodeModule.createRequire(configFile).cache;
  for (const file of files) Reflect.deleteProperty(cache, file);
  const port = hookPort();
  if (port === false) return;
  reloadVersion += 1;
  const urls = files.map((file) => pathToFileURL(file).href);
  port.ref();
  try {
    const answered = once(port, "message");
    port.postMessage({ urls, version: reloadVersion });
    await answered;
  } finally {
    port.unref();
  }
}

/** Loads one config file with jiti and validates it; its folder is the project's folder. */
export async function loadConfigFile(
  configFile: string,
): Promise<ParseResult<Config & { configFile: string }>> {
  if (!existsSync(configFile)) {
    return {
      ok: false,
      errors: [
        `config file not found: ${configFile}\n  = fix: check the path given to --config (it is relative to the folder you run in)`,
      ],
    };
  }
  const count = (loads.get(configFile) ?? 0) + 1;
  loads.set(configFile, count);
  if (count > 1) await forgetLocalImports(configFile);
  let exported: unknown;
  try {
    // Without `default: true`, a module that has no default export stays distinguishable
    // (jiti would otherwise hand back the module's namespace as if it were the config).
    // Evaluated from the file's current text: `import()` returns Node's cached module for a
    // .js/.mjs config, so an edited config would never reload in the language server.
    const loaded: unknown = await createJiti(configFile, {
      moduleCache: false,
      fsCache: false,
    }).evalModule(readFileSync(configFile, "utf8"), {
      filename: configFile,
      async: true,
      forceTranspile: true,
    });
    exported =
      typeof loaded === "object" && loaded !== null && "default" in loaded
        ? loaded.default
        : undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [describeLoadFailure(configFile, reason)] };
  }
  if (typeof exported !== "object" || exported === null) {
    const name = path.basename(configFile);
    return {
      ok: false,
      errors: [`${name} must export the config: export default defineConfig({ ... })`],
    };
  }
  // The first line that names each old rule id, for the notice that says where to rename it.
  const places = renamedIdsIn(readFileSync(configFile, "utf8"));
  const parsed = parseConfig(
    exported,
    path.dirname(configFile),
    path.basename(configFile),
    (id) => places.find((place) => place.before === id)?.line,
  );
  if (!parsed.ok) return { ok: false, errors: parsed.errors.map((e) => `${configFile}: ${e}`) };
  // The rules that are on are loaded now, so a check can run them; the rest never load.
  try {
    await loadRules(parsed.value);
  } catch (error) {
    if (error instanceof RuleLoadError || error instanceof RuleDeclarationError) {
      return { ok: false, errors: [`${configFile}: ${error.message}`] };
    }
    throw error;
  }
  const warnings = [
    ...ignoredConfigWarnings(configFile),
    ...parsed.value.warnings,
    ...foreignTypeScriptWarnings(configFile),
  ];
  return { ok: true, value: { ...parsed.value, warnings, configFile } };
}
