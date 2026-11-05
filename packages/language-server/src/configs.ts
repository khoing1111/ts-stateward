import path from "node:path";
import { findConfigFile, findConfigUpward, toTypeScriptPath } from "@stateward/core/internal";

/** Whether `file` is `folder` or inside it (paths compared as TypeScript writes them). */
function isInside(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The innermost of `folders` that holds `file`, or undefined when none does. */
export function folderOf(file: string, folders: readonly string[]): string | undefined {
  return folders
    .filter((folder) => isInside(file, folder))
    .sort((a, b) => b.length - a.length)
    .at(0);
}

/**
 * The outermost of `folders` that holds `file`: where the config search stops. With nested
 * workspace folders (`/repo` and `/repo/packages/app`), a file of the inner one still finds the
 * config at `/repo`.
 */
function outermostFolderOf(file: string, folders: readonly string[]): string | undefined {
  return folders
    .filter((folder) => isInside(file, folder))
    .sort((a, b) => a.length - b.length)
    .at(0);
}

/** Which config each file belongs to: the nearest `stateward.config.*` above it, inside the workspace folders. */
export type ConfigLocator = {
  /** The config file of `file`, or undefined when no config above it is inside a workspace folder. */
  configOf(file: string): string | undefined;
  /** The configs at the root of a workspace folder, in the folders' order: checked from the start. */
  rootConfigs(): readonly string[];
  /** A config file was created or deleted: look again. */
  forget(): void;
};

export function createConfigLocator(folders: readonly string[]): ConfigLocator {
  /** By folder: the config that folder's files belong to (null: none), so a lookup walks once. */
  const known = new Map<string, string | null>();
  return {
    configOf(file) {
      const folder = outermostFolderOf(file, folders);
      if (folder === undefined) return undefined;
      const dir = toTypeScriptPath(path.dirname(file));
      let found = known.get(dir);
      if (found === undefined) {
        found = findConfigUpward(path.dirname(file), folder) ?? null;
        known.set(dir, found);
      }
      return found ?? undefined;
    },
    rootConfigs() {
      return folders.flatMap((folder) => {
        const found = findConfigFile(folder);
        return found === undefined ? [] : [found];
      });
    },
    forget() {
      known.clear();
    },
  };
}
