import path from "node:path";
import { fileURLToPath } from "node:url";

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/**
 * `file` with forward slashes. TypeScript names files with `/` on every system, while `path`
 * joins with `\` on Windows, so tests compare both sides in this form.
 */
export function posix(file: string): string {
  return file.split(path.sep).join("/");
}

/** The finding with its location's file in forward slashes (see posix). */
export function withPosixFile<T extends { readonly location: { readonly file: string } }>(
  finding: T,
): T {
  return { ...finding, location: { ...finding.location, file: posix(finding.location.file) } };
}
