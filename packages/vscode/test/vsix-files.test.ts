import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const vsce = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@vscode/vsce/package.json")),
  "vsce",
);

/**
 * The files `vsce package` would put in the .vsix, read with `vsce ls` from a copy of the
 * manifest and .vscodeignore beside placeholder build files, so the test needs no bundle.
 */
function vsixFiles(): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-vsix-"));
  try {
    for (const file of ["package.json", ".vscodeignore", "LICENSE"]) {
      copyFileSync(path.join(pkg, file), path.join(dir, file));
    }
    mkdirSync(path.join(dir, "dist"));
    const built = ["extension.cjs", "server.cjs", "babel.cjs", "THIRD-PARTY-NOTICES.txt"];
    for (const file of [...built, "lib.es5.d.ts", "extension.js", "extension.js.map"]) {
      writeFileSync(path.join(dir, "dist", file), "");
    }
    const listed = spawnSync(process.execPath, [vsce, "ls", "--no-dependencies"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(listed.status, listed.stderr).toBe(0);
    return listed.stdout.split("\n").filter((line) => line !== "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the .vsix", () => {
  it("holds the licence and the third-party notices, with the bundles and nothing else built", () => {
    expect(vsixFiles().sort()).toEqual([
      "LICENSE",
      "dist/THIRD-PARTY-NOTICES.txt",
      "dist/babel.cjs",
      "dist/extension.cjs",
      "dist/lib.es5.d.ts",
      "dist/server.cjs",
      "package.json",
    ]);
  });
});
