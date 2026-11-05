import path from "node:path";
import { toTypeScriptPath } from "@stateward/core/internal";

export type ChangeKind = "config" | "config-import" | "source" | "ignored";

const CONFIG_NAME = /^stateward\.config\.(?:ts|mts|js|mjs)$/;
const SCRIPT = /\.[cm]?js$/;
/** JSON files no program imports and that change often: they must not cost a pass. */
const NOT_SOURCE_JSON = new Set(["package.json", "package-lock.json"]);

/**
 * JavaScript files the server asks the editor to watch: a config can import a local `.mjs` or `.js`
 * file (a team's shared rules), whose change must reload that config.
 */
export const SCRIPT_GLOB = "**/*.{js,mjs,cjs}";

/**
 * Whether `file` is a JSON file a program may import (`resolveJsonModule`), so the editor's unsaved
 * text of it matters: not one in `node_modules`, not `package.json` or the lockfile, not a
 * tsconfig or a stateward file (those are read as configuration, never as an import).
 */
export function isImportableJson(file: string): boolean {
  const normal = toTypeScriptPath(file);
  if (!normal.endsWith(".json") || normal.includes("/node_modules/")) return false;
  const name = path.basename(file);
  return !(
    NOT_SOURCE_JSON.has(name) ||
    /^tsconfig.*\.json$/.test(name) ||
    /^stateward\..*\.json$/.test(name)
  );
}

/**
 * What a change to `file` (outside the editor) means: a config changed (in any folder: each config
 * has its own engine), a local file a config imports changed (`configImports`, TypeScript paths),
 * some other file changed, or the change does not count: in `node_modules`, a JavaScript file no
 * config imports (build output must not start a check), or `package.json` and the lockfile (a
 * tsconfig, a stateward file and any other `.json` a program may import count as a source change).
 */
export function classifyChange(
  file: string,
  configImports: ReadonlySet<string> = new Set(),
): ChangeKind {
  const normal = toTypeScriptPath(file);
  if (normal.includes("/node_modules/")) return "ignored";
  if (CONFIG_NAME.test(path.basename(file))) return "config";
  if (configImports.has(normal)) return "config-import";
  if (NOT_SOURCE_JSON.has(path.basename(file))) return "ignored";
  return SCRIPT.test(normal) ? "ignored" : "source";
}

/**
 * Remembers the last error shown, so the same error is not shown again on every check. A success
 * forgets it: the same error after a recovery is news again.
 */
export type ErrorGate = {
  /** True when `text` differs from the last error shown, and remembers it. */
  shouldShow(text: string): boolean;
  recovered(): void;
};

export function createErrorGate(): ErrorGate {
  let last: string | undefined;
  return {
    shouldShow(text) {
      if (text === last) return false;
      last = text;
      return true;
    },
    recovered() {
      last = undefined;
    },
  };
}
