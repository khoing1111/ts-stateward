import { createRequire } from "node:module";
import path from "node:path";

/**
 * Where the TypeScript language server comes from. `projectServer` is the project's own
 * `@stateward/language-server`, which the `stateward.serverPath` setting overrides; undefined
 * when the project has none.
 */
export type ServerLocation =
  | { kind: "configured"; modulePath: string; projectServer: string | undefined }
  | { kind: "workspace"; modulePath: string }
  | { kind: "bundled"; modulePath: string };

function isUnresolvable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED")
  );
}

/** The project's own `@stateward/language-server`, undefined when it has none. */
function projectServerOf(workspaceDir: string | undefined): string | undefined {
  if (workspaceDir === undefined) return undefined;
  try {
    const resolveFromWorkspace = createRequire(path.join(workspaceDir, "package.json"));
    return resolveFromWorkspace.resolve("@stateward/language-server/bin");
  } catch (error) {
    if (!isUnresolvable(error)) throw error;
    return undefined;
  }
}

/**
 * The `stateward.serverPath` setting first (a clone's own server, for testing a clone), when that
 * file exists. Then the workspace's own `@stateward/language-server`, so the editor and
 * `stateward check` run the same version. Then the copy bundled with the extension.
 */
export function locateServer(
  workspaceDir: string | undefined,
  bundledModule: string,
  configured: {
    path: string;
    exists: (file: string) => boolean;
    /** The file with every link followed (Node's resolver returns the project's server so). */
    realPath?: (file: string) => string;
  } = {
    path: "",
    exists: () => false,
  },
): ServerLocation {
  const projectServer = projectServerOf(workspaceDir);
  if (configured.path !== "" && configured.exists(configured.path)) {
    const real = configured.realPath ?? ((file: string) => file);
    // The setting names the project's own server through a link: nothing overrides it.
    if (projectServer !== undefined && real(configured.path) === real(projectServer)) {
      return { kind: "workspace", modulePath: projectServer };
    }
    return { kind: "configured", modulePath: configured.path, projectServer };
  }
  if (projectServer !== undefined) return { kind: "workspace", modulePath: projectServer };
  return { kind: "bundled", modulePath: bundledModule };
}

/** The log line that names the server the extension starts. */
export function serverSourceLine(location: ServerLocation): string {
  switch (location.kind) {
    case "configured":
      return `Stateward is using the server from the stateward.serverPath setting: ${location.modulePath}`;
    case "workspace":
      return `Stateward is using the project's server: ${location.modulePath}`;
    case "bundled":
      return `Stateward is using the server bundled with the extension: ${location.modulePath}`;
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

/** The line the status bar tooltip adds: only when the setting overrides the usual lookup. */
export function serverSourceNote(location: ServerLocation | undefined): string | undefined {
  return location?.kind === "configured" ? serverSourceLine(location) : undefined;
}

export const USE_PROJECT_SERVER = "Use the project's server";
export const KEEP_SERVER_PATH = "Keep";

/**
 * The one-time notification when the setting overrides a server the project has installed;
 * undefined when it does not.
 */
export function serverPathNotice(location: ServerLocation): string | undefined {
  if (location.kind !== "configured" || location.projectServer === undefined) return undefined;
  return `Stateward is using the server from the stateward.serverPath setting (${location.modulePath}), not the project's @stateward/language-server (${location.projectServer}). The setting is in your user settings.`;
}

/** The key that remembers the notification was shown for this pair of servers. */
export function serverPathNoticeKey(location: ServerLocation): string {
  const project = location.kind === "configured" ? (location.projectServer ?? "") : "";
  return `stateward.serverPathNotice:${location.modulePath}:${project}`;
}

/**
 * The message for a server that does not implement a request the extension needs (it answered
 * MethodNotFound): the server is older than the extension, and how to change it.
 */
export function unsupportedMessage(location: ServerLocation | undefined, command: string): string {
  switch (location?.kind) {
    case "configured":
      return `The language server at ${location.modulePath} is older than the extension and does not support ${command}. Remove stateward.serverPath from your user settings, or update @stateward/language-server.`;
    case "workspace":
      return `The project's language server at ${location.modulePath} is older than the extension and does not support ${command}. Update @stateward/language-server in the project.`;
    case "bundled":
    case undefined:
      return `The language server does not support ${command}. Reinstall the Stateward extension.`;
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}
