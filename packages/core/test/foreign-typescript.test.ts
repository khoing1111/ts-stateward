import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/internal.js";
import { computeImplementationId } from "../src/implementation.js";

/*
 * Review 5, proof 2: a team rule written as the guide once showed (`import ts from "typescript"`)
 * gets the app's TypeScript 5.8, whose syntax kinds do not match the 6.0 that parsed the code, so
 * it reported nothing; and swapping that TypeScript left the cached findings in place.
 */

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-foreign-ts-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, text: string): string {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** p2: an app with its own TypeScript 5.8 and a team rule that imports it. */
function p2(rule: string): string {
  write("package.json", '{"name":"app","version":"1.0.0"}');
  write("node_modules/typescript/package.json", typescriptManifest("5.8.2"));
  write("node_modules/typescript/index.js", 'module.exports = { version: "5.8.2" };');
  write("rules/team.ts", rule);
  return write(
    "stateward.config.ts",
    'import { team } from "./rules/team.ts";\nexport default { plugins: [team] };\n',
  );
}

function typescriptManifest(version: string, integrity?: string): string {
  return JSON.stringify({
    name: "typescript",
    version,
    main: "index.js",
    ...(integrity === undefined ? {} : { _integrity: integrity }),
  });
}

const TEAM = 'export const team = { name: "team", description: "d", rules: {} };\n';

describe("a local rule that imports its own TypeScript", () => {
  it("is warned about once, at config load, naming the file and the version", async () => {
    p2(`import ts from "typescript";\nvoid ts;\n${TEAM}`);
    const loaded = await loadConfig(dir);
    expect(loaded.ok ? loaded.value.warnings : loaded.errors).toEqual([
      "`rules/team.ts` imports the app's TypeScript 5.8; use `@stateward/core/typescript`, or it may see nothing",
    ]);
  });

  it("is not warned about when the rule does not import TypeScript", async () => {
    p2(TEAM);
    const loaded = await loadConfig(dir);
    expect(loaded.ok ? loaded.value.warnings : loaded.errors).toEqual([]);
  });

  it("changes the implementation id when that TypeScript is swapped for another version or build", () => {
    const config = p2(`import ts from "typescript";\nvoid ts;\n${TEAM}`);
    const before = computeImplementationId(config);
    write("node_modules/typescript/package.json", typescriptManifest("5.9.3"));
    const swapped = computeImplementationId(config);
    expect(swapped).not.toBe(before);
    write("node_modules/typescript/package.json", typescriptManifest("5.9.3", "sha512-other"));
    expect(computeImplementationId(config)).not.toBe(swapped);
  });
});
