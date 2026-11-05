import { createRequire } from "node:module";
import path from "node:path";

export type ServerLocation = {
  kind: "configured" | "workspace" | "bundled";
  /** The module the client starts as the language server. */
  modulePath: string;
};

function isUnresolvable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
  );
}

/**
 * The `stateward.serverPath` setting first (a clone's own server, as `pnpm try` prints, so the
 * editor runs the same packages as the CLI), when that file exists. Then the workspace's own
 * `@stateward/language-server`, so the editor and `stateward check` run the same version. Then
 * the copy bundled with the extension.
 */
export function locateServer(
  workspaceDir: string | undefined,
  bundledModule: string,
  configured: { path: string; exists: (file: string) => boolean } = {
    path: "",
    exists: () => false,
  },
): ServerLocation {
  if (configured.path !== "" && configured.exists(configured.path)) {
    return { kind: "configured", modulePath: configured.path };
  }
  if (workspaceDir !== undefined) {
    try {
      const resolveFromWorkspace = createRequire(path.join(workspaceDir, "package.json"));
      const modulePath = resolveFromWorkspace.resolve("@stateward/language-server/bin");
      return { kind: "workspace", modulePath };
    } catch (error) {
      if (!isUnresolvable(error)) throw error;
    }
  }
  return { kind: "bundled", modulePath: bundledModule };
}
