import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * `file` with every link followed, as git prints a repository's root; `file` resolved when it
 * does not exist. Two paths compared or made relative to each other take this form both, or a
 * project reached through a link (`/tmp` on macOS is `/private/tmp`) gives `../../private/…`.
 */
export function realPath(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
}
