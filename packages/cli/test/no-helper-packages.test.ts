import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Stateward ships no runtime package, so no rule, hint or fix may tell a developer
 * to install or import one. The rules' sources (their explain pages, messages and fixes) and the
 * generated docs are searched for the names of the packages that were removed.
 */

const root = fileURLToPath(new URL("../../..", import.meta.url));
const REMOVED = /@stateward\/(?:guards|values|states|react-context)\b/;

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full, extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

function naming(files: readonly string[]): string[] {
  return files
    .filter((file) => REMOVED.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"));
}

describe("no removed helper package is named", () => {
  it("by any rule's source: its explain page, messages and fixes", () => {
    const sources = readdirSync(path.join(root, "packages"))
      .filter((name) => name.startsWith("plugin-"))
      .flatMap((name) => filesUnder(path.join(root, "packages", name, "src"), ".ts"));
    expect(sources.length).toBeGreaterThan(0);
    expect(naming(sources)).toEqual([]);
  });

  it("by the generated docs of the packs and rules", () => {
    const docs = [
      ...filesUnder(path.join(root, "docs", "packs"), ".md"),
      ...filesUnder(path.join(root, "docs", "rules"), ".md"),
    ];
    expect(docs.length).toBeGreaterThan(0);
    expect(naming(docs)).toEqual([]);
  });
});
