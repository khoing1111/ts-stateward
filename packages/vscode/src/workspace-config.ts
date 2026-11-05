import { existsSync } from "node:fs";
import path from "node:path";

/** The config file names stateward looks for at a project root; the same four as `@stateward/core`. */
export const CONFIG_FILE_NAMES = [
  "stateward.config.ts",
  "stateward.config.mts",
  "stateward.config.js",
  "stateward.config.mjs",
] as const;

/** The first of `folders` that has a stateward config file at its root. */
export function folderWithConfig(folders: readonly string[]): string | undefined {
  return folders.find((folder) =>
    CONFIG_FILE_NAMES.some((name) => existsSync(path.join(folder, name))),
  );
}

/** True when any of `folders` has a stateward config file at its root. */
export function hasStatewardConfig(folders: readonly string[]): boolean {
  return folderWithConfig(folders) !== undefined;
}

/**
 * What the editor tells the server about: sources, tsconfigs, JSON files, the config, the rollout file
 * (`stateward next` in a terminal changes which rules run) and the baseline file.
 */
export const WATCH_GLOBS = [
  "**/*.{ts,tsx,mts,cts}",
  "**/tsconfig*.json",
  // A program can import any JSON file (`resolveJsonModule`); the server ignores the ones it cannot.
  "**/*.json",
  "**/stateward.config.{ts,mts,js,mjs}",
  "**/stateward.rollout.json",
  "**/stateward.baseline.json",
] as const;
