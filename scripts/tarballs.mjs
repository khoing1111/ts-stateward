// The packed files in artifacts/ and how to install them with each package manager. Shared by
// install-into.mjs and pack-smoke.mjs.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const artifacts = path.join(root, "artifacts");

/** The version of the tarball (or the `.vsix`) in a file name: `stateward-core-0.1.0-beta.2.tgz` is `0.1.0-beta.2`. */
export function versionOf(file) {
  return /-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(?:tgz|vsix)$/.exec(file)?.[1];
}

/** The version of this source: the CLI package's, which every package shares. */
export function sourceVersion() {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "packages", "cli", "package.json"), "utf8"),
  );
  return manifest.version;
}

/**
 * Why `dir` cannot be installed from, or undefined when it holds the packs of `version`: it has no
 * tarballs, or one of its files was packed from another version of the source.
 */
export function staleArtifacts(version, dir = artifacts) {
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const packed = files.filter((file) => packageNameOf(file) !== undefined);
  if (packed.length === 0) return "artifacts/ has no packed files";
  const others = [
    ...new Set(
      files.map((file) => versionOf(file)).filter((v) => v !== undefined && v !== version),
    ),
  ];
  if (others.length > 0)
    return `artifacts/ holds ${others.sort().join(", ")}, the source is ${version}`;
  if (!files.includes(`stateward-vscode-${version}.vsix`))
    return "artifacts/ has no .vsix for this version";
  return undefined;
}

/** `stateward-plugin-unions-0.0.0.tgz` is `@stateward/plugin-unions`; `stateward-0.0.0.tgz` is `stateward`. */
export function packageNameOf(file) {
  const match = /^(.*?)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz$/.exec(file);
  if (match === null) return undefined;
  const base = match[1];
  return base === "stateward" ? "stateward" : `@stateward/${base.replace(/^stateward-/, "")}`;
}

/** Package name to the absolute path of its tarball, for every tarball in `dir`. */
export function tarballMap(dir = artifacts) {
  const map = {};
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const name = packageNameOf(file);
    if (name !== undefined) map[name] = path.join(dir, file);
  }
  return map;
}

/** The package manager of a project, from its lockfile; npm when there is none. */
export function detectManager(projectDir) {
  if (existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

/** `file:` followed by a path written with forward slashes, which every manager reads. */
export function fileSpec(file) {
  return `file:${file.split(path.sep).join("/")}`;
}

/** The object with its keys in alphabetical order, as npm writes them. */
export function sortedKeys(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * The manifest without the packed stateward files an older copy added that are no longer packed
 * (`file:` entries of stateward packages not in `specs`).
 */
export function withoutStale(manifest, specs) {
  const isStale = (name, spec) =>
    (name === "stateward" || name.startsWith("@stateward/")) &&
    typeof spec === "string" &&
    spec.startsWith("file:") &&
    !(name in specs);
  const clean = (table) =>
    table === undefined
      ? undefined
      : Object.fromEntries(Object.entries(table).filter(([name, spec]) => !isStale(name, spec)));
  const result = { ...manifest };
  for (const key of ["devDependencies", "dependencies", "overrides", "resolutions"]) {
    if (manifest[key] !== undefined) result[key] = clean(manifest[key]);
  }
  if (manifest.pnpm?.overrides !== undefined) {
    result.pnpm = { ...manifest.pnpm, overrides: clean(manifest.pnpm.overrides) };
  }
  return result;
}

/**
 * The tarballs name each other (`@stateward/core` `0.0.0`), which no registry has, so pnpm and
 * yarn need each name mapped to its file first. Returns the package.json with that mapping
 * (pnpm `overrides`, yarn `resolutions`); npm needs none, unless `options.npmOverrides` is set
 * (vendored files: npm then keeps the nested names on the same files).
 * `specs` maps each package name to its `file:` spec; `options.devDependencies` also writes them
 * as devDependencies.
 */
export function withMapping(manifest, manager, specs, options = {}) {
  const base = options.devDependencies
    ? { ...manifest, devDependencies: sortedKeys({ ...manifest.devDependencies, ...specs }) }
    : manifest;
  if (manager === "pnpm") {
    return {
      ...base,
      pnpm: { ...base.pnpm, overrides: { ...base.pnpm?.overrides, ...specs } },
    };
  }
  if (manager === "yarn") return { ...base, resolutions: { ...base.resolutions, ...specs } };
  if (options.npmOverrides) return { ...base, overrides: { ...base.overrides, ...specs } };
  return base;
}

/** The install command (program and arguments) for the manager, run in the project's folder. */
export function installCommand(manager, map) {
  const files = Object.values(map).map((file) => (manager === "npm" ? file : fileSpec(file)));
  if (manager === "yarn") return ["yarn", ["add", "--dev", ...files]];
  if (manager === "pnpm") return ["pnpm", ["add", "--save-dev", ...files]];
  return ["npm", ["install", "--no-audit", "--no-fund", "--save-dev", ...files]];
}

export function readManifest(projectDir) {
  return JSON.parse(readFileSync(path.join(projectDir, "package.json"), "utf8"));
}

/** The command that installs what package.json already lists (used after `--vendor`). */
export function plainInstallCommand(manager) {
  if (manager === "yarn") return ["yarn", ["install"]];
  if (manager === "pnpm") return ["pnpm", ["install"]];
  return ["npm", ["install", "--no-audit", "--no-fund"]];
}
