import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Preset } from "@stateward/core/internal";
import { PACK_CATALOG, packOf } from "./catalog.js";
import type { PackDetection, PackName } from "./catalog.js";

export {
  PACK_CATALOG,
  PACK_NAMES,
  UnknownPackError,
  importNameOf,
  isPackName,
  packDescription,
} from "./catalog.js";
export type { PackDetection, PackEntry, PackName } from "./catalog.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Thrown when package.json exists but cannot be understood: a failed read is not "no react" (C35). */
export class PackageJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageJsonError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lists(manifest: Record<string, unknown>, field: string, name: string): boolean {
  const value = manifest[field];
  return isRecord(value) && name in value;
}

function parseManifest(packageJsonText: string): Record<string, unknown> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJsonText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PackageJsonError(`package.json is not valid JSON: ${reason}`);
  }
  if (!isRecord(manifest)) throw new PackageJsonError("package.json must be a JSON object");
  return manifest;
}

/** Whether package.json lists `name` in dependencies or devDependencies. */
function dependsOn(manifest: Record<string, unknown>, name: string): boolean {
  return lists(manifest, "dependencies", name) || lists(manifest, "devDependencies", name);
}

/** Whether package.json lists `react` in dependencies or devDependencies. */
export function usesReact(packageJsonText: string): boolean {
  return dependsOn(parseManifest(packageJsonText), "react");
}

/**
 * The packs a project needs, by each pack's `detect` in the catalog: `unions`, `records`, `async`
 * and `errors` always (they read plain TypeScript; `errors` infers what calls throw),
 * `react-context` and `react` when it uses React. `ownership` and `reducers` are chosen with
 * `--packs` or in the questions: they ask for a shape the team decides on. Listed in the order of
 * `PACK_NAMES`.
 */
export function detectPacks(packageJsonText: string | undefined): readonly PackName[] {
  const manifest = packageJsonText === undefined ? undefined : parseManifest(packageJsonText);
  return PACK_CATALOG.filter((pack) => wanted(pack.detect, manifest)).map((pack) => pack.name);
}

function wanted(detect: PackDetection, manifest: Record<string, unknown> | undefined): boolean {
  switch (detect.kind) {
    case "always":
      return true;
    case "chosen":
      return false;
    case "dependency":
      return (
        manifest !== undefined && detect.dependencies.some((name) => dependsOn(manifest, name))
      );
    default: {
      const unreachable: never = detect;
      return unreachable;
    }
  }
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

/** From the lockfile, the first found in the order npm, pnpm, yarn, bun; npm when there is none. */
export function detectPackageManager(exists: (file: string) => boolean): PackageManager {
  return LOCKFILES.find(([file]) => exists(file))?.[1] ?? "npm";
}

/** The lockfile that decided `detectPackageManager`, or undefined when there is none. */
export function detectLockfile(exists: (file: string) => boolean): string | undefined {
  return LOCKFILES.find(([file]) => exists(file))?.[0];
}

/** The add-on that makes `react-context` follow React Router routes. */
export const REACT_ROUTER_ADDON = "react-context/react-router";

/** Whether package.json lists React Router (`react-router` or `react-router-dom`). */
export function usesReactRouter(packageJsonText: string | undefined): boolean {
  if (packageJsonText === undefined) return false;
  const manifest = parseManifest(packageJsonText);
  return dependsOn(manifest, "react-router") || dependsOn(manifest, "react-router-dom");
}

/**
 * `rollout` adds `rollout: true`: the project meets its rules one at a time.
 * `addons` adds `addons: [...]` (names as `<plugin>/<addon>`).
 */
export function renderConfig(
  packs: readonly PackName[],
  preset: Preset,
  rollout = false,
  addons: readonly string[] = [],
): string {
  const imports = packs.map(
    (name) => `import { ${packOf(name).importName} } from "${packOf(name).packageName}";`,
  );
  const plugins = packs.map((name) => `${packOf(name).importName}()`);
  return [
    'import { defineConfig } from "stateward";',
    ...imports,
    "",
    "export default defineConfig({",
    `  plugins: [${plugins.join(", ")}],`,
    `  // turns on the ${preset} rules of these packs; remove it to choose rules one by one`,
    `  preset: "${preset}",`,
    ...(addons.length > 0 ? [`  addons: [${addons.map((name) => `"${name}"`).join(", ")}],`] : []),
    ...(rollout ? ["  rollout: true,"] : []),
    "});",
    "",
  ].join("\n");
}

/** The command that adds development dependencies with the project's package manager. */
function addCommand(manager: PackageManager): string {
  switch (manager) {
    case "npm":
      return "npm install --save-dev";
    case "pnpm":
      return "pnpm add -D";
    case "yarn":
      return "yarn add -D";
    case "bun":
      return "bun add -d";
    default: {
      const unreachable: never = manager;
      return unreachable;
    }
  }
}

/** The command that installs what the generated config imports. It is printed, never run. */
export function installCommand(manager: PackageManager, packs: readonly PackName[]): string {
  const packages = ["stateward", ...packs.map((name) => packOf(name).packageName)];
  return `${addCommand(manager)} ${packages.join(" ")}`;
}

const CODE_FILE = /\.tsx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

function hasSourceFile(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) =>
    entry.isDirectory()
      ? entry.name !== "node_modules" && hasSourceFile(path.join(dir, entry.name))
      : CODE_FILE.test(entry.name) && !DECLARATION_FILE.test(entry.name),
  );
}

/** The `files` of tsconfig.json; none when it is missing, has comments, or lists nothing. */
function tsconfigFiles(cwd: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(cwd, "tsconfig.json"), "utf8"));
    const files = isRecord(parsed) ? parsed.files : undefined;
    return Array.isArray(files) ? files.filter((file) => typeof file === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Whether the project already has code to check: a `.ts` or `.tsx` file under `src`, or one listed
 * in its tsconfig's `files`. It decides whether `init` suggests turning rules on one at a time.
 */
export function projectHasCode(cwd: string): boolean {
  return (
    hasSourceFile(path.join(cwd, "src")) ||
    tsconfigFiles(cwd).some(
      (file) =>
        CODE_FILE.test(file) && !DECLARATION_FILE.test(file) && existsSync(path.join(cwd, file)),
    )
  );
}
