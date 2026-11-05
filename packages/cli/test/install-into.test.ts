import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
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

function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-install-into-"));
  dirs.push(dir);
  return dir;
}

/**
 * A small copy of the repository: the real install scripts, a source at `version`, and a stand-in
 * `pack.mjs` that writes the packs of that version (or fails).
 */
function repo(version: string, packWorks = true): string {
  const dir = temp();
  mkdirSync(path.join(dir, "scripts"));
  for (const file of ["install-into.mjs", "tarballs.mjs", "run.mjs"]) {
    cpSync(path.join(scripts, file), path.join(dir, "scripts", file));
  }
  mkdirSync(path.join(dir, "packages", "cli"), { recursive: true });
  writeFileSync(path.join(dir, "packages", "cli", "package.json"), JSON.stringify({ version }));
  writeFileSync(
    path.join(dir, "scripts", "pack.mjs"),
    packWorks
      ? [
          'import { mkdirSync, rmSync, writeFileSync } from "node:fs";',
          'rmSync("artifacts", { recursive: true, force: true });',
          'mkdirSync("artifacts");',
          `for (const name of ["stateward", "stateward-core"]) writeFileSync("artifacts/" + name + "-${version}.tgz", "x");`,
          `writeFileSync("artifacts/stateward-vscode-${version}.vsix", "x");`,
          'console.log("packed");',
        ].join("\n")
      : 'console.error("build broke"); process.exit(1);\n',
  );
  return dir;
}

function putArtifacts(dir: string, version: string): void {
  mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  for (const name of ["stateward", "stateward-core"]) {
    writeFileSync(path.join(dir, "artifacts", `${name}-${version}.tgz`), "old");
  }
  writeFileSync(path.join(dir, "artifacts", `stateward-vscode-${version}.vsix`), "old");
}

function app(manifest: object = {}): string {
  const dir = temp();
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "app", ...manifest }));
  return dir;
}

function installInto(
  repoDir: string,
  appDir: string,
  ...flags: string[]
): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(repoDir, "scripts", "install-into.mjs"), appDir, ...flags],
    { encoding: "utf8", cwd: repoDir },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function devDependencyNames(file: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("devDependencies" in manifest)) {
    return [];
  }
  const table = manifest.devDependencies;
  return typeof table === "object" && table !== null ? Object.keys(table) : [];
}

describe("install-into packs first", () => {
  it("packs when artifacts/ is missing, and says which version it vendored", () => {
    const source = repo("0.2.0");
    const target = app();
    const { status, output } = installInto(source, target, "--vendor");
    expect(status).toBe(0);
    expect(output).toContain("artifacts/ has no packed files; packing 0.2.0 first");
    expect(output).toContain(
      "vendored stateward 0.2.0: 2 packages and stateward-vscode-0.2.0.vsix",
    );
    expect(readdirSync(path.join(target, "vendor", "stateward")).sort()).toEqual([
      "stateward-0.2.0.tgz",
      "stateward-core-0.2.0.tgz",
      "stateward-vscode-0.2.0.vsix",
    ]);
  });

  it("packs when the artifacts are of another version, so old tarballs are never vendored", () => {
    const source = repo("0.2.0");
    putArtifacts(source, "0.1.0");
    const target = app();
    const { status, output } = installInto(source, target, "--vendor");
    expect(status).toBe(0);
    expect(output).toContain("artifacts/ holds 0.1.0, the source is 0.2.0; packing 0.2.0 first");
    expect(readdirSync(path.join(target, "vendor", "stateward"))).not.toContain(
      "stateward-0.1.0.tgz",
    );
  });

  it("does not pack when the artifacts match the source", () => {
    const source = repo("0.2.0");
    putArtifacts(source, "0.2.0");
    const { status, output } = installInto(source, app(), "--vendor");
    expect(status).toBe(0);
    expect(output).not.toContain("packing");
  });

  it("stops with the error when packing fails, and vendors nothing", () => {
    const source = repo("0.2.0", false);
    putArtifacts(source, "0.1.0");
    const target = app();
    const { status, output } = installInto(source, target, "--vendor");
    expect(status).toBe(2);
    expect(output).toContain("build broke");
    expect(output).toContain("packing failed, so nothing was installed or copied");
    expect(existsSync(path.join(target, "vendor"))).toBe(false);
  });
});

describe("install-into --vendor writes the app's package.json", () => {
  it("adds only the current packs, sorted, and drops stale stateward files", () => {
    const source = repo("0.2.0");
    const target = app({
      devDependencies: {
        zod: "1.0.0",
        "@stateward/react-context": "file:./vendor/stateward/stateward-react-context-0.1.0.tgz",
        vitest: "5.0.0",
      },
    });
    installInto(source, target, "--vendor");
    const names = devDependencyNames(path.join(target, "package.json"));
    expect(names).toEqual(["@stateward/core", "stateward", "vitest", "zod"]);
  });

  it("replaces the .vsix in the vendor folder and keeps other files", () => {
    const source = repo("0.2.0");
    const target = app();
    const folder = path.join(target, "vendor", "stateward");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "stateward-vscode-0.1.0.vsix"), "old");
    writeFileSync(path.join(folder, "notes.txt"), "mine");
    installInto(source, target, "--vendor");
    expect(readdirSync(folder).sort()).toEqual([
      "notes.txt",
      "stateward-0.2.0.tgz",
      "stateward-core-0.2.0.tgz",
      "stateward-vscode-0.2.0.vsix",
    ]);
  });
});

describe("install-into for pnpm", () => {
  it("writes pnpm-workspace.yaml with the overrides in a project of its own", () => {
    const source = repo("0.2.0");
    const target = app();
    writeFileSync(path.join(target, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const { output } = installInto(source, target, "--vendor");
    expect(output).toContain("wrote pnpm-workspace.yaml with the overrides");
    expect(readFileSync(path.join(target, "pnpm-workspace.yaml"), "utf8")).toContain("overrides:");
  });

  it("writes none inside an existing pnpm workspace, and says where the overrides go", () => {
    const source = repo("0.2.0");
    const workspace = temp();
    writeFileSync(path.join(workspace, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    const target = path.join(workspace, "apps", "web");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "web" }));
    writeFileSync(path.join(target, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const { output } = installInto(source, target, "--vendor");
    expect(existsSync(path.join(target, "pnpm-workspace.yaml"))).toBe(false);
    expect(output).toContain(
      `wrote no pnpm-workspace.yaml: the project is inside the pnpm workspace of ${path.join(workspace, "pnpm-workspace.yaml")}. With pnpm 11 or later, add the overrides there:\noverrides:\n  "stateward": "file:./apps/web/vendor/stateward/stateward-0.2.0.tgz"\n  "@stateward/core": "file:./apps/web/vendor/stateward/stateward-core-0.2.0.tgz"`,
    );
    expect(readFileSync(path.join(workspace, "pnpm-workspace.yaml"), "utf8")).toBe(
      "packages:\n  - apps/*\n",
    );
  });
});
