// Installs the packed stateward files (artifacts/, made by `pnpm run pack`) into your project with
// the package manager the project uses (found from its lockfile): npm, yarn or pnpm.
//   pnpm run install-into /path/to/your-app
//   pnpm run install-into /path/to/your-app --vendor [dir]   (copy the files into the app, for a team and CI)
// Then, in the project: npx stateward init
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "./run.mjs";
import {
  detectManager,
  fileSpec,
  installCommand,
  packageNameOf,
  plainInstallCommand,
  readManifest,
  root,
  sourceVersion,
  staleArtifacts,
  tarballMap,
  withMapping,
  withoutStale,
} from "./tarballs.mjs";

const DEFAULT_VENDOR_DIR = "vendor/stateward";
const USAGE = "pnpm run install-into /path/to/your-app [--vendor [dir]] [--install]";

function fail(message) {
  console.error(`install-into: ${message}`);
  process.exit(2);
}

/** `--vendor` alone means the default folder; `--vendor dir` and `--vendor=dir` name one. */
function parseArgs(args) {
  let project;
  let vendor;
  let install = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--install") install = true;
    else if (arg === "--vendor") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-") && project !== undefined) {
        vendor = next;
        i++;
      } else vendor = DEFAULT_VENDOR_DIR;
    } else if (arg.startsWith("--vendor=")) vendor = arg.slice("--vendor=".length);
    else if (arg.startsWith("-")) fail(`unknown option ${arg}. Use: ${USAGE}`);
    else if (project === undefined) project = arg;
    else fail(`unexpected ${arg}. Use: ${USAGE}`);
  }
  if (project === undefined) fail(`give the folder of your project: ${USAGE}`);
  if (vendor === "") fail("--vendor needs a folder name, or no value for vendor/stateward");
  return { project, vendor, install };
}

const options = parseArgs(process.argv.slice(2));
const project = path.resolve(options.project);
if (!existsSync(path.join(project, "package.json"))) fail(`no package.json in ${project}`);

// Never install files packed from another version of the source: pack again first, and stop if
// that fails.
const version = sourceVersion();
const stale = staleArtifacts(version);
if (stale !== undefined) {
  console.log(`${stale}; packing ${version} first`);
  const packed = run(process.execPath, [path.join(root, "scripts", "pack.mjs")], {
    cwd: root,
    inherit: true,
  });
  if (packed.status !== 0) {
    fail(
      `packing failed, so nothing was installed or copied. Fix the error above, then run this again`,
    );
  }
}
const map = tarballMap();
if (Object.keys(map).length === 0) fail("artifacts/ has no packed files after packing");

const manager = detectManager(project);
const manifest = withoutStale(
  readManifest(project),
  Object.fromEntries(Object.keys(map).map((name) => [name, true])),
);

/** The packages as `file:` specs, and what the manager is told to install. */
let specs;
let vendorDir;
if (options.vendor === undefined) {
  console.log(`installing stateward ${version} from artifacts/`);
  specs = Object.fromEntries(Object.entries(map).map(([name, file]) => [name, fileSpec(file)]));
} else {
  const target = path.resolve(project, options.vendor);
  const relative = path.relative(project, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`--vendor ${options.vendor} must be a folder inside ${project}`);
  }
  vendorDir = relative.split(path.sep).join("/");
  mkdirSync(target, { recursive: true });
  // An older copy leaves files with another version in their names; only packed stateward files
  // are removed, so anything else the team keeps in the folder stays.
  for (const old of readdirSync(target)) {
    if (packageNameOf(old) !== undefined) rmSync(path.join(target, old));
  }
  specs = {};
  for (const [name, file] of Object.entries(map)) {
    copyFileSync(file, path.join(target, path.basename(file)));
    specs[name] = `file:./${vendorDir}/${path.basename(file)}`;
  }
  // The extension travels with the packs: older copies of it are removed, and a project's
  // `code --install-extension` line stays the same file name per version.
  for (const old of readdirSync(target)) {
    if (/^stateward-vscode-.*\.vsix$/.test(old)) rmSync(path.join(target, old));
  }
  const vsix = `stateward-vscode-${version}.vsix`;
  copyFileSync(path.join(root, "artifacts", vsix), path.join(target, vsix));
  console.log(
    `vendored stateward ${version}: ${String(Object.keys(map).length)} packages and ${vsix} into ${vendorDir}/`,
  );
}

const vendored = vendorDir !== undefined;
const mapped = withMapping(manifest, manager, specs, {
  devDependencies: vendored,
  npmOverrides: vendored,
});
if (JSON.stringify(mapped) !== JSON.stringify(readManifest(project))) {
  writeFileSync(path.join(project, "package.json"), `${JSON.stringify(mapped, null, 2)}\n`);
  const where =
    manager === "yarn" ? "resolutions" : manager === "pnpm" ? "pnpm.overrides" : "overrides";
  console.log(
    vendored
      ? `wrote devDependencies and ${where} in package.json, pointing at ${vendorDir}/`
      : `added the tarball paths to package.json (${where})`,
  );
}
/** The pnpm-workspace.yaml of a workspace that holds `dir` from a folder above it, if any. */
function enclosingWorkspaceFile(dir) {
  for (let parent = path.dirname(dir); ; parent = path.dirname(parent)) {
    const file = path.join(parent, "pnpm-workspace.yaml");
    if (existsSync(file)) return file;
    if (path.dirname(parent) === parent) return undefined;
  }
}

// pnpm 10 reads overrides from package.json; pnpm 11 and later only from pnpm-workspace.yaml.
const workspaceFile = path.join(project, "pnpm-workspace.yaml");
if (manager === "pnpm") {
  const overrides = (base) =>
    Object.entries(specs)
      .map(([name, spec]) => {
        // A `file:./` path is relative to the folder of the file that holds it.
        const rebased = spec.startsWith("file:./")
          ? fileSpec(`./${path.relative(base, path.join(project, spec.slice("file:".length)))}`)
          : spec;
        return `  ${JSON.stringify(name)}: ${JSON.stringify(rebased)}`;
      })
      .join("\n");
  const enclosing = existsSync(workspaceFile) ? undefined : enclosingWorkspaceFile(project);
  if (existsSync(workspaceFile)) {
    console.log(
      "pnpm-workspace.yaml exists; if pnpm cannot find the packages, add the overrides there too",
    );
  } else if (enclosing !== undefined) {
    // A pnpm-workspace.yaml here would make the project a workspace of its own, cut off from the
    // one it belongs to.
    console.log(
      `wrote no pnpm-workspace.yaml: the project is inside the pnpm workspace of ${enclosing}. With pnpm 11 or later, add the overrides there:\noverrides:\n${overrides(path.dirname(enclosing))}`,
    );
  } else {
    writeFileSync(workspaceFile, `overrides:\n${overrides(project)}\n`);
    console.log("wrote pnpm-workspace.yaml with the overrides");
  }
}

if (vendored && !options.install) {
  const [program, args] = plainInstallCommand(manager);
  console.log(
    `\nNothing was installed. In the project, run:\n  ${program} ${args.join(" ")}\n` +
      `Then commit ${vendorDir}/, package.json and the lockfile: CI installs from them.\n` +
      `To upgrade: git pull and pnpm run pack in the stateward clone, run this command again with\n` +
      `the same folder, then run the install command above and commit the result.`,
  );
  process.exit(0);
}

if (!vendored) {
  // The paths name this clone's artifacts/ folder: on another machine, or in CI, they name nothing.
  console.log(
    `\nThe file: paths written (package.json${manager === "pnpm" ? ", pnpm-workspace.yaml" : ""} and the lockfile) point at ${path.join(root, "artifacts")}\n` +
      `and work only on this machine: do not commit them. For a team or CI, run this again with --vendor.\n`,
  );
}

const [program, args] = vendored ? plainInstallCommand(manager) : installCommand(manager, map);
console.log(
  `$ ${program} ${args[0]} ... (${String(Object.keys(map).length)} stateward packages, ${manager})`,
);
const result = run(program, args, { cwd: project, inherit: true });
if (result.status !== 0) {
  fail(`${program} failed; the message above says why. Fix it, then run this again`);
}
console.log("\nInstalled. Next, in the project:\n  npx stateward init");
