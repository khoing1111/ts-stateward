// The config `pnpm try` writes into an app, shared with `pnpm run corpus`: every pack of this
// clone imported by absolute path, so nothing is installed into the app.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every add-on of every pack, as `addons` in a config names them. scripts/docs.mjs (in the gate)
 * fails when this list and the add-ons the packs declare differ.
 */
export const ALL_ADDONS = [
  "records/keyed-maps",
  "react/flag-combos",
  "react/effect-race",
  "errors/catch-intent",
  "errors/narrow-try",
  "react-context/react-router",
  "react-context/dynamic-components",
];

/**
 * A built package's entry as a plain absolute path with forward slashes, not a file:// URL: the
 * config loader accepts both, but TypeScript (what gives the config its types in the editor)
 * resolves only paths. Undefined when the package is not built.
 */
export function packEntry(dir) {
  const entry = path.join(root, "packages", dir, "dist", "index.js");
  return existsSync(entry) ? entry.split(path.sep).join("/") : undefined;
}

/** Every pack, in the order the config lists them; `react`: only for an app that uses React. */
const PACKS = [
  { name: "unions", factory: "unions", dir: "plugin-unions", react: false },
  { name: "records", factory: "records", dir: "plugin-records", react: false },
  { name: "async", factory: "asyncFlow", dir: "plugin-async", react: false },
  { name: "errors", factory: "errors", dir: "plugin-errors", react: false },
  { name: "ownership", factory: "ownership", dir: "plugin-ownership", react: false },
  { name: "reducers", factory: "reducers", dir: "plugin-reducers", react: false },
  { name: "react-context", factory: "reactContext", dir: "plugin-react-context", react: true },
  { name: "react", factory: "react", dir: "plugin-react", react: true },
];

/** The packs the config turns on for an app: what `try` writes, and what it says it wrote. */
export function packsFor({ usesReact }) {
  return PACKS.filter((pack) => usesReact || !pack.react);
}

/**
 * The lines of the config: the packs (react-context only with React), the preset, rollout off and
 * the given add-ons; `tsconfig`, when given, is written as the config's `tsconfig`.
 */
export function configLines({ usesReact, addons, tsconfig, entry = packEntry }) {
  const from = (dir) => {
    const resolved = entry(dir);
    if (resolved === undefined) {
      throw new Error(`${dir} is not built: run "pnpm run build" in ${root} first`);
    }
    return JSON.stringify(resolved);
  };
  return [
    "// @ts-check: VS Code then checks this file and completes its keys from defineConfig's types.",
    "// @ts-check",
    `import { defineConfig } from ${from("core")};`,
    // The packs every app gets by folder name, then React's in the order they are listed.
    ...[
      ...packsFor({ usesReact: false }).sort((a, b) =>
        a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0,
      ),
      ...packsFor({ usesReact }).filter((pack) => pack.react),
    ].map(({ factory, dir }) => `import { ${factory} } from ${from(dir)};`),
    "",
    "export default defineConfig({",
    ...(tsconfig === undefined ? [] : [`  tsconfig: ${JSON.stringify(tsconfig)},`]),
    `  plugins: [${packsFor({ usesReact })
      .map(({ factory }) => `${factory}()`)
      .join(", ")}],`,
    "  // turns on the recommended rules of these packs; remove it to choose rules one by one",
    '  preset: "recommended",',
    "  // true: rules are turned on one at a time (`pnpm try <app> --next` sets it for you)",
    "  rollout: false,",
    `  addons: [${addons.map((addon) => JSON.stringify(addon)).join(", ")}],`,
    "});",
    "",
  ];
}

/** The folders under `base` matching one workspace glob (`packages/*`, `apps/**`, `tools/cli`), sorted. */
function workspaceDirs(app, glob) {
  const parts = glob.replace(/\/+$/, "").split("/");
  let dirs = [app];
  for (const part of parts) {
    const next = [];
    for (const dir of dirs) {
      if (part === "**") {
        // Every folder below, at any depth, except installed packages and hidden folders.
        const walk = (at) => {
          next.push(at);
          for (const entry of readdirSync(at, { withFileTypes: true })) {
            if (
              entry.isDirectory() &&
              entry.name !== "node_modules" &&
              !entry.name.startsWith(".")
            ) {
              walk(path.join(at, entry.name));
            }
          }
        };
        walk(dir);
      } else if (part.includes("*")) {
        const pattern = new RegExp(
          `^${part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
        );
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== "node_modules" && pattern.test(entry.name)) {
            next.push(path.join(dir, entry.name));
          }
        }
      } else {
        const child = path.join(dir, part);
        if (existsSync(child)) next.push(child);
      }
    }
    dirs = next;
  }
  return dirs;
}

/** The `packages:` globs of a pnpm-workspace.yaml: list entries, quoted or not. */
function pnpmGlobs(text) {
  const globs = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) inPackages = false;
    const item = inPackages ? /^\s+-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line) : null;
    if (item) globs.push(item[1]);
  }
  return globs;
}

/**
 * The workspace globs of a monorepo root (`pnpm-workspace.yaml`, or `workspaces` in package.json,
 * as npm, yarn and bun write it), with the manager that declares them; undefined for a single app.
 */
export function workspaceGlobs(app) {
  const pnpm = path.join(app, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) return { manager: "pnpm", globs: pnpmGlobs(readFileSync(pnpm, "utf8")) };
  const manifest = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
  const { workspaces } = manifest;
  const globs = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  return Array.isArray(globs) ? { manager: "npm", globs } : undefined;
}

/**
 * The tsconfig.json of each workspace package of a monorepo root, relative to it with forward
 * slashes, sorted; a `!` glob leaves packages out, as the package managers do.
 */
export function workspaceTsconfigs(app, globs) {
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith("!"))
      .flatMap((glob) => workspaceDirs(app, glob.slice(1))),
  );
  const found = globs
    .filter((glob) => !glob.startsWith("!"))
    .flatMap((glob) => workspaceDirs(app, glob))
    .filter((dir) => dir !== app && !excluded.has(dir))
    .map((dir) => path.join(dir, "tsconfig.json"))
    .filter((file) => existsSync(file))
    .map((file) => path.relative(app, file).split(path.sep).join("/"));
  return [...new Set(found)].sort();
}

/** The `package.json` files of the workspace packages: their dependencies say whether React is used. */
export function workspaceManifests(app, globs) {
  return globs
    .filter((glob) => !glob.startsWith("!"))
    .flatMap((glob) => workspaceDirs(app, glob))
    .map((dir) => path.join(dir, "package.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Whether a monorepo root's tsconfig.json is one stateward can check: it references the packages'
 * projects, or names its own files. A root tsconfig with neither is a base the packages extend; read
 * as a project it would check every package with the root's options.
 */
export function rootTsconfigUsable(app) {
  const file = path.join(app, "tsconfig.json");
  if (!existsSync(file)) return false;
  const ts = createRequire(path.join(root, "package.json"))("typescript");
  const read = ts.readConfigFile(file, (name) => ts.sys.readFile(name));
  if (read.error !== undefined) return false;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, app, undefined, file);
  if ((parsed.projectReferences?.length ?? 0) > 0) return true;
  const names = read.config.include !== undefined || read.config.files !== undefined;
  return names && parsed.fileNames.some((name) => !name.endsWith(".d.ts"));
}
