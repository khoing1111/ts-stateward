// Proves the packed artifacts work: installs the tarballs into a copy of examples/basic and into an
// empty project, with npm and again with pnpm (users may use any package manager), and runs the CLI
// there. Needs network (the installs fetch react and typescript).
// Run it with: pnpm run pack:smoke
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmCommand, run, runPnpm } from "./run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const failures = [];
// `pnpm`, or `corepack pnpm` when pnpm is not on PATH: as the gate and pack do.
const pnpm = pnpmCommand();

function report(name, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}`);
  if (!ok) {
    failures.push(name);
    if (detail !== undefined) console.log(detail.trimEnd().split("\n").slice(-30).join("\n"));
  }
  return ok;
}

// examples/basic extends the repo's tsconfig; a project outside the repo needs its own.
const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["src", "stateward.config.ts"],
};

const MANAGERS = [
  {
    name: "npm",
    install: (cwd, packages, tarballs) =>
      run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", ...packages, ...tarballs], {
        cwd,
      }),
    exec: (cwd, bin, args) => run("npx", ["--no-install", bin, ...args], { cwd }),
  },
  {
    name: "pnpm",
    // The tarballs name each other (@stateward/core "0.0.0"), which is not on any registry, so the
    // overrides point those names at the files. pnpm 10 reads them from package.json's `pnpm` field
    // and pnpm 10.x later from pnpm-workspace.yaml, which is all that pnpm 12 reads; corepack
    // picks the newest pnpm for a project that does not pin one, so the repo's version is pinned
    // here and the overrides are written both ways.
    install: (cwd, packages, tarballs) => {
      const manifestPath = path.join(cwd, "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const overrides = Object.fromEntries(
        tarballs.map((file) => [packageNameOf(file), `file:${file}`]),
      );
      const repoManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      writeFileSync(
        manifestPath,
        `${JSON.stringify(
          { ...manifest, packageManager: repoManifest.packageManager, pnpm: { overrides } },
          null,
          2,
        )}\n`,
      );
      const yaml = Object.entries(overrides)
        .map(([name, target]) => `  ${JSON.stringify(name)}: ${JSON.stringify(target)}`)
        .join("\n");
      writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), `overrides:\n${yaml}\n`);
      return runPnpm(["add", "--save-dev", ...packages, ...tarballs], { cwd }, pnpm);
    },
    exec: (cwd, bin, args) => runPnpm(["exec", bin, ...args], { cwd }, pnpm),
  },
  {
    // yarn 1 maps names to files with `resolutions`; `pnpm run install-into` writes them and picks
    // yarn from yarn.lock, so this tests that script too. Skipped when yarn is not installed.
    name: "yarn",
    available: () => run("yarn", ["--version"], { cwd: os.tmpdir() }).status === 0,
    install: (cwd, packages) => {
      const first = run("yarn", ["add", "--dev", ...packages], { cwd });
      if (first.status !== 0) return first;
      return run("node", [path.join(root, "scripts", "install-into.mjs"), cwd]);
    },
    exec: (cwd, bin, args) => run("yarn", ["run", "--silent", bin, ...args], { cwd }),
  },
];

/** The package name inside a tarball, read from its package.json. */
function packageNameOf(file) {
  // tar runs inside artifacts/ with a bare file name: GNU tar (Git Bash on Windows) reads `C:` in a
  // full path as a remote host and fails (as in pack.mjs).
  const manifest = run("tar", ["-xzOf", path.basename(file), "package/package.json"], {
    cwd: path.dirname(file),
  });
  return JSON.parse(manifest.output).name;
}

/** The real folders of every installed `typescript` package under `dir`/node_modules. */
function typescriptCopies(dir) {
  const found = new Set();
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.name === "typescript" && existsSync(path.join(full, "package.json"))) {
        const manifest = JSON.parse(readFileSync(path.join(full, "package.json"), "utf8"));
        if (manifest.name === "typescript") found.add(realpathSync(full));
      } else if (entry.isDirectory()) walk(full);
    }
  };
  if (existsSync(path.join(dir, "node_modules"))) walk(path.join(dir, "node_modules"));
  return [...found];
}

/** Plugins and the CLI take TypeScript through @stateward/core: an app gets one copy. */
function reportOneTypescript(label, dir) {
  const copies = typescriptCopies(dir);
  const versions = copies.map(
    (copy) => JSON.parse(readFileSync(path.join(copy, "package.json"), "utf8")).version,
  );
  report(
    label("exactly one TypeScript 6 copy installed"),
    copies.length === 1 && versions.every((v) => v.startsWith("6.")),
    `found ${String(copies.length)}:\n${copies.map((c, i) => `${versions[i]}  ${c}`).join("\n")}`,
  );
}

const packResult = runPnpm(["run", "pack"], { cwd: root }, pnpm);
if (!report("pnpm run pack", packResult.status === 0, packResult.output)) process.exit(1);

const tarballs = readdirSync(artifacts)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => path.join(artifacts, f));

/** `install-into --vendor` copies the files into the app and installs from them, with no clone path. */
function vendorSmoke(manager, temp) {
  if (manager.name === "pnpm") return;
  const label = (text) => `[${manager.name}] vendor: ${text}`;
  const app = path.join(temp, `vendor-${manager.name}`);
  mkdirSync(app);
  writeFileSync(
    path.join(app, "package.json"),
    `${JSON.stringify({ name: "smoke-vendor", private: true, type: "module" }, null, 2)}\n`,
  );
  // An empty lockfile tells install-into which manager the app uses.
  if (manager.name === "yarn") writeFileSync(path.join(app, "yarn.lock"), "");
  const script = path.join(root, "scripts", "install-into.mjs");
  const copy = run("node", [script, app, "--vendor"]);
  const manifest = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
  const specs = Object.values(manifest.devDependencies ?? {});
  report(
    label("copies the files and writes relative file: dependencies"),
    copy.status === 0 &&
      existsSync(path.join(app, "vendor", "stateward")) &&
      specs.length > 0 &&
      specs.every((spec) => spec.startsWith("file:./vendor/stateward/")) &&
      !JSON.stringify(manifest).includes(root),
    copy.output,
  );
  const installed = run(manager.name, ["install"], { cwd: app });
  if (report(label("install from the vendor folder"), installed.status === 0, installed.output)) {
    reportOneTypescript(label, app);
    const help = manager.exec(app, "stateward", ["--version"]);
    report(label("stateward runs"), help.status === 0, help.output);
  }
}

/**
 * The owner's case: the app has its own TypeScript 5.8. stateward brings TypeScript 6 once, under
 * @stateward/core, and `stateward check` still runs.
 */
function oldTypescriptSmoke(manager, temp) {
  if (manager.name === "pnpm") return;
  const label = (text) => `[${manager.name}] app on TypeScript 5.8: ${text}`;
  const app = path.join(temp, `ts58-${manager.name}`);
  cpSync(path.join(root, "examples", "basic"), app, {
    recursive: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
  writeFileSync(
    path.join(app, "package.json"),
    `${JSON.stringify({ name: "smoke-ts58", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(path.join(app, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  const installed = manager.install(app, ["react", "@types/react", "typescript@~5.8.3"], tarballs);
  if (!report(label("install"), installed.status === 0, installed.output)) return;
  const copies = typescriptCopies(app).map((copy) => ({
    copy,
    version: JSON.parse(readFileSync(path.join(copy, "package.json"), "utf8")).version,
  }));
  const six = copies.filter((c) => c.version.startsWith("6."));
  report(
    label("exactly one TypeScript 6 copy, under @stateward/core"),
    six.length === 1 &&
      six[0].copy.includes(path.join("@stateward", "core")) &&
      copies.some((c) => c.version.startsWith("5.8.")),
    copies.map((c) => `${c.version}  ${c.copy}`).join("\n"),
  );
  const check = manager.exec(app, "stateward", ["check"]);
  report(
    label("stateward check runs and reports"),
    check.status === 1 && check.output.includes("records/ambiguous-table"),
    `exit code ${String(check.status)}\n${check.output}`,
  );
}

/** Every installed package folder under `dir`/node_modules (pnpm's store folder included), by name. */
function installedNames(dir) {
  const names = new Set();
  const walk = (folder, depth) => {
    if (!existsSync(folder) || depth > 8) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const manifest = path.join(full, "package.json");
      if (existsSync(manifest) && !entry.isSymbolicLink()) {
        names.add(JSON.parse(readFileSync(manifest, "utf8")).name);
      }
      // pnpm keeps packages under .pnpm/<name>@<version>/node_modules; scopes are folders.
      if (entry.name.startsWith("@") || entry.name === ".pnpm" || entry.name === "node_modules") {
        walk(full, depth + 1);
      } else if (existsSync(path.join(full, "node_modules"))) {
        walk(path.join(full, "node_modules"), depth + 1);
      }
    }
  };
  walk(path.join(dir, "node_modules"), 0);
  return names;
}

/** The tarballs of these package names. */
function tarballsOf(names) {
  return tarballs.filter((file) => names.includes(packageNameOf(file)));
}

/**
 * Install only what you use (plan step PKG2): an app without React that installs the CLI and the
 * unions and records packs gets no React pack and no React types, and `stateward check` runs.
 */
function leanSmoke(manager, temp) {
  if (manager.name === "yarn") return;
  const label = (text) => `[${manager.name}] non-React app, two packs: ${text}`;
  const app = path.join(temp, `lean-${manager.name}`);
  mkdirSync(path.join(app, "src"), { recursive: true });
  writeFileSync(
    path.join(app, "package.json"),
    `${JSON.stringify({ name: "smoke-lean", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(path.join(app, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  writeFileSync(
    path.join(app, "src", "status.ts"),
    [
      'export type Status = "idle" | "loading" | "done";',
      "export function label(status: Status): string {",
      "  switch (status) {",
      '    case "idle":',
      '      return "Idle";',
      "    default:",
      '      return "Busy";',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(app, "stateward.config.ts"),
    [
      'import { defineConfig } from "stateward";',
      'import { records } from "@stateward/plugin-records";',
      'import { unions } from "@stateward/plugin-unions";',
      "",
      'export default defineConfig({ plugins: [unions(), records()], preset: "recommended" });',
      "",
    ].join("\n"),
  );
  const wanted = tarballsOf([
    "@stateward/core",
    "stateward",
    "@stateward/plugin-unions",
    "@stateward/plugin-records",
  ]);
  const installed = manager.install(app, ["typescript@~6.0.3"], wanted);
  if (!report(label("install"), installed.status === 0, installed.output)) return;
  const names = installedNames(app);
  const unwanted = [...names].filter(
    (name) =>
      name.startsWith("@stateward/plugin-react") || name === "@types/react" || name === "react",
  );
  report(
    label("no @stateward/plugin-react*, no react and no @types/react in node_modules"),
    unwanted.length === 0 && names.has("@stateward/plugin-unions") && names.has("stateward"),
    `found: ${unwanted.join(", ") || "none"}; installed: ${[...names].sort().join(", ")}`,
  );
  const check = manager.exec(app, "stateward", ["check"]);
  report(
    label("stateward check runs and reports unions/non-exhaustive-switch"),
    check.status === 1 && check.output.includes("unions/non-exhaustive-switch"),
    `exit code ${String(check.status)}\n${check.output}`,
  );
}

function smoke(manager, temp) {
  const label = (text) => `[${manager.name}] ${text}`;
  const app = path.join(temp, `app-${manager.name}`);
  cpSync(path.join(root, "examples", "basic"), app, {
    recursive: true,
    filter: (source) => path.basename(source) !== "node_modules",
  });
  // The example's package.json links the workspace packages; a project outside the repo has none.
  writeFileSync(
    path.join(app, "package.json"),
    `${JSON.stringify({ name: "smoke-app", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(path.join(app, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);

  const installApp = manager.install(app, ["react", "@types/react", "typescript@~6.0.3"], tarballs);
  if (
    report(
      label("install tarballs into examples/basic copy"),
      installApp.status === 0,
      installApp.output,
    )
  ) {
    reportOneTypescript(label, app);
    const check = manager.exec(app, "stateward", ["check"]);
    report(
      label(
        "stateward check exits 1 and reports react-context/fake-default-value, unions/non-exhaustive-switch and records/ambiguous-table",
      ),
      check.status === 1 &&
        check.output.includes("react-context/fake-default-value") &&
        check.output.includes("unions/non-exhaustive-switch") &&
        check.output.includes("records/ambiguous-table"),
      `exit code ${String(check.status)}\n${check.output}`,
    );
  }

  vendorSmoke(manager, temp);
  oldTypescriptSmoke(manager, temp);
  leanSmoke(manager, temp);

  const empty = path.join(temp, `empty-${manager.name}`);
  mkdirSync(empty);
  writeFileSync(
    path.join(empty, "package.json"),
    `${JSON.stringify({ name: "smoke-empty", private: true, type: "module" }, null, 2)}\n`,
  );
  writeFileSync(path.join(empty, "tsconfig.json"), `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  const installEmpty = manager.install(empty, ["typescript@~6.0.3"], tarballs);
  if (
    report(
      label("install tarballs into empty project"),
      installEmpty.status === 0,
      installEmpty.output,
    )
  ) {
    const init = manager.exec(empty, "stateward", ["init"]);
    report(
      label("stateward init writes stateward.config.ts"),
      init.status === 0 && existsSync(path.join(empty, "stateward.config.ts")),
      `exit code ${String(init.status)}\n${init.output}`,
    );
  }
}

const temp = mkdtempSync(path.join(os.tmpdir(), "stateward-smoke-"));
try {
  for (const manager of MANAGERS) {
    if (manager.available?.() === false) console.log(`skip  [${manager.name}] not installed`);
    else smoke(manager, temp);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(
    `\npack:smoke failed: ${failures.join("; ")}. Fix the first failure above, then run "pnpm run pack:smoke" again.`,
  );
  process.exit(1);
}
console.log("\npack:smoke passed");
