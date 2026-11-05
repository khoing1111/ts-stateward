// Builds every package and the VS Code extension into artifacts/ so they can be installed
// in another project before anything is published. Run it with: pnpm run pack
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmCommand, run } from "./run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
// Everything is built here first; artifacts/ is replaced only when the whole build worked, so a
// failed build leaves the files of the last good one.
const building = path.join(root, ".scratch", "pack-next");
const [pnpm, pnpmArgs] = pnpmCommand();

const PACKAGES = [
  "@stateward/core",
  "stateward",
  "@stateward/language-server",
  "@stateward/plugin-react-context",
  "@stateward/plugin-ownership",
  "@stateward/plugin-errors",
  "@stateward/plugin-unions",
  "@stateward/plugin-reducers",
  "@stateward/plugin-react",
  "@stateward/plugin-async",
  "@stateward/plugin-records",
];

function abandon() {
  rmSync(building, { recursive: true, force: true });
  process.exit(1);
}

function step(label, command, args, cwd) {
  const result = run(
    command === "pnpm" ? pnpm : command,
    command === "pnpm" ? [...pnpmArgs, ...args] : args,
    { cwd },
  );
  if (result.status !== 0) {
    console.error(`pack failed at: ${label}`);
    console.error(result.output.trimEnd().split("\n").slice(-40).join("\n"));
    console.error(
      `Fix the error above, then run "pnpm run pack" again. ${existsSync(artifacts) ? "artifacts/ still holds the last good build." : ""}`.trimEnd(),
    );
    abandon();
  }
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

// Only ever deletes folders inside this repository.
rmSync(building, { recursive: true, force: true });
mkdirSync(building, { recursive: true });

step("pnpm run build", "pnpm", ["run", "build"], root);
step("vscode bundle", "pnpm", ["--filter", "stateward-vscode", "run", "bundle"], root);
// pnpm pack writes the real versions in place of "workspace:*" into each tarball's package.json.
step(
  "pnpm pack",
  "pnpm",
  [...PACKAGES.flatMap((name) => ["--filter", name]), "pack", "--pack-destination", building],
  root,
);

const extensionDir = path.join(root, "packages", "vscode");
const version = JSON.parse(readFileSync(path.join(extensionDir, "package.json"), "utf8")).version;
const vsix = path.join(building, `stateward-vscode-${version}.vsix`);
// --allow-missing-repository stops vsce asking about a repository the extension does not name
// yet. The LICENSE is packed (vsce asks when there is none).
step(
  "vsce package",
  "pnpm",
  ["exec", "vsce", "package", "--no-dependencies", "--allow-missing-repository", "--out", vsix],
  extensionDir,
);

const files = readdirSync(building).sort();
const tarballs = files.filter((f) => f.endsWith(".tgz"));
if (tarballs.length !== PACKAGES.length || !files.includes(path.basename(vsix))) {
  console.error(
    `pack failed: expected ${String(PACKAGES.length)} .tgz files and ${path.basename(vsix)} in the build, found: ${files.join(", ") || "nothing"}.`,
  );
  abandon();
}

// A tarball that still says "workspace:" cannot be installed by anyone outside this repository.
// tar runs inside artifacts/ with a bare file name: GNU tar (Git Bash on Windows) reads `C:` in a
// full path as a remote host and fails.
for (const file of tarballs) {
  const manifest = run("tar", ["-xzOf", file, "package/package.json"], { cwd: building });
  if (manifest.status !== 0 || manifest.output.includes("workspace:")) {
    console.error(
      `pack failed: ${file} has no readable package.json or still contains "workspace:".`,
    );
    abandon();
  }
}

rmSync(artifacts, { recursive: true, force: true });
renameSync(building, artifacts);

for (const file of files) {
  console.log(`${file.padEnd(48)} ${formatSize(statSync(path.join(artifacts, file)).size)}`);
}

const finalVsix = path.join(artifacts, path.basename(vsix));
const quoted = (file) => (/\s/.test(file) ? `"${file}"` : file);
console.log("\nInstall in your project, with npm, yarn or pnpm (whichever its lockfile says):");
console.log("  pnpm run install-into /path/to/your-app");
console.log("Install the VS Code extension:");
console.log(`  code --install-extension ${quoted(finalVsix)}`);
console.log("  (no `code` command? VS Code: Extensions, the ... menu, Install from VSIX...)");
