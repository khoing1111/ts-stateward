import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scripts = fileURLToPath(new URL("../../../scripts", import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pack.mjs", () => {
  it("runs pnpm through `corepack pnpm` when pnpm is not on PATH, and a failed build leaves the old artifacts", () => {
    const repo = mkdtempSync(path.join(tmpdir(), "stateward-pack-"));
    dirs.push(repo);
    mkdirSync(path.join(repo, "scripts"));
    for (const file of ["pack.mjs", "tarballs.mjs", "run.mjs"]) {
      cpSync(path.join(scripts, file), path.join(repo, "scripts", file));
    }
    mkdirSync(path.join(repo, "packages", "cli"), { recursive: true });
    writeFileSync(path.join(repo, "packages", "cli", "package.json"), '{"version":"0.2.0"}');
    mkdirSync(path.join(repo, "packages", "vscode"), { recursive: true });
    writeFileSync(path.join(repo, "packages", "vscode", "package.json"), '{"version":"0.2.0"}');
    mkdirSync(path.join(repo, "artifacts"));
    writeFileSync(path.join(repo, "artifacts", "stateward-0.1.0.tgz"), "last good build");

    // A PATH with a `corepack` that records how it was called and fails, and no `pnpm`.
    const bin = path.join(repo, "bin");
    mkdirSync(bin);
    const log = path.join(repo, "corepack.log");
    if (process.platform === "win32") {
      // On Windows a program started through the shell is a .cmd file.
      writeFileSync(path.join(bin, "corepack.cmd"), `@>>"${log}" echo %*\r\n@exit /b 1\r\n`);
    } else {
      writeFileSync(path.join(bin, "corepack"), `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
      chmodSync(path.join(bin, "corepack"), 0o755);
    }

    const result = spawnSync(process.execPath, [path.join(repo, "scripts", "pack.mjs")], {
      encoding: "utf8",
      cwd: repo,
      env: { ...process.env, PATH: bin },
    });

    expect(result.status).toBe(1);
    expect(readFileSync(log, "utf8")).toContain("pnpm run build");
    expect(result.stderr).toContain("pack failed at: pnpm run build");
    expect(result.stderr).toContain("artifacts/ still holds the last good build");
    expect(readdirSync(path.join(repo, "artifacts"))).toEqual(["stateward-0.1.0.tgz"]);
    expect(readdirSync(path.join(repo, ".scratch"))).toEqual([]);
  });
});
