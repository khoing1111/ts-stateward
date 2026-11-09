import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnpmCommand, run, runPnpmAsync } from "./run.mjs";

const scratch = mkdtempSync(path.join(os.tmpdir(), "stateward-gate-"));
const vitestReport = path.join(scratch, "vitest.json");

/**
 * The failed tests of vitest's JSON report, one line each, under a count: the last 40 lines of
 * output can hide all but a few of them. Empty when the report is missing or not readable.
 */
function failedTests(reportPath) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    return "";
  }
  const names = [];
  for (const file of report.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      if (test.status === "failed")
        names.push(
          `${path.relative(process.cwd(), file.name).split(path.sep).join("/")}: ${test.fullName}`,
        );
    }
    // A file that failed to load has no test results, only a message.
    if (file.status === "failed" && (file.assertionResults ?? []).length === 0) {
      names.push(
        `${path.relative(process.cwd(), file.name).split(path.sep).join("/")}: the file did not run`,
      );
    }
  }
  return `${String(names.length)} failed test(s) of ${String(report.numTotalTests ?? "?")}:\n${names.map((name) => `  ${name}`).join("\n")}`;
}

// `--changed`: the loop while working. Prettier, eslint and vitest look at what git says changed
// (HEAD against the working tree, and new files; vitest runs the tests of the packages that changed); the bundle and its smoke test are left out.
// The full gate, with no flag, is what runs once before handing over and in CI.
const changedMode = process.argv.includes("--changed");

/** Files under the working tree that differ from HEAD or are new, relative to here, still on disk. */
function changedFiles() {
  const lists = [
    run("git", ["diff", "--name-only", "--relative", "HEAD", "--", "."]),
    run("git", ["ls-files", "--others", "--exclude-standard"]),
  ];
  return [...new Set(lists.flatMap((list) => list.output.split("\n")))]
    .filter((file) => file !== "" && existsSync(file))
    .sort();
}

const LINTED = /\.(?:[cm]?[jt]sx?)$/;
const PRETTIER = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|html)$/;

/**
 * Where eslint keeps its cache: a folder named by what typed rules read besides the linted file
 * itself (every source and test helper, the configs, the lockfile), so a change to any of them
 * starts an empty cache instead of trusting a result that read the old types. Earlier folders go.
 */
function eslintCacheLocation() {
  const hash = createHash("sha256");
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (["node_modules", "dist", "fixtures"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        hash.update(`${full}\0`).update(readFileSync(full));
      }
    }
  };
  for (const folder of readdirSync("packages")) visit(path.join("packages", folder));
  for (const file of [
    "eslint.config.js",
    "pnpm-lock.yaml",
    "package.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "vitest.config.ts",
    "vitest.setup.ts",
    "stateward.config.ts",
  ]) {
    if (existsSync(file)) hash.update(`${file}\0`).update(readFileSync(file));
  }
  const root = path.join("node_modules", ".cache", "stateward", "eslint");
  const name = hash.digest("hex").slice(0, 24);
  mkdirSync(root, { recursive: true });
  for (const old of readdirSync(root))
    if (old !== name) rmSync(path.join(root, old), { recursive: true, force: true });
  return path.join(root, name, "cache");
}

const changed = changedMode ? changedFiles() : [];

/**
 * The vitest file filters for the changed files: the tests of each package whose files changed. vitest's
 * own `--changed` would run everything after any source change, because the setup file imports
 * every pack. A change to core (every pack builds on it) or outside packages/ runs every test.
 */
function testFilters(files) {
  const folders = new Set();
  for (const file of files) {
    const match = /^packages\/([^/]+)\//.exec(file);
    if (match === null || match[1] === "core") return [];
    folders.add(`packages/${match[1]}/test`);
  }
  return [...folders];
}

const lintTargets = changedMode ? changed.filter((file) => LINTED.test(file)) : ["."];
const formatTargets = changedMode ? changed.filter((file) => PRETTIER.test(file)) : ["."];

// Steps in the order their lines print. `after` names the steps that must pass first (a failed
// step leaves its dependents unrun); the others start at once, so the single-threaded ones (tsc,
// prettier, eslint, the bundle) run beside vitest and docs:check instead of before them.
const steps = [
  {
    name: "prettier",
    args: ["exec", "prettier", "--check", ...formatTargets],
    skip: formatTargets.length === 0,
  },
  // build is tsc -b, then the marker that makes dist/cjs CommonJS. Before eslint: its typed rules
  // read the workspace packages' declarations, which a fresh clone does not have until it builds.
  { name: "tsc", args: ["run", "build"] },
  {
    name: "eslint",
    args: [
      "exec",
      "eslint",
      "--max-warnings",
      "0",
      "--cache",
      "--cache-location",
      eslintCacheLocation(),
      // A changed file that the config ignores (a rule's fixture) is not a warning.
      ...(changedMode ? ["--no-warn-ignored"] : []),
      ...lintTargets,
    ],
    after: ["tsc"],
    skip: lintTargets.length === 0,
  },
  // Runs every rule example; an example's output is cached by what it reads (scripts/docs-examples.mjs).
  { name: "docs:check", args: ["run", "docs:check"], after: ["tsc"] },
  {
    name: "vitest",
    args: [
      "exec",
      "vitest",
      "run",
      ...(changedMode ? ["--passWithNoTests", ...testFilters(changed)] : []),
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${vitestReport}`,
    ],
    after: ["tsc"],
    // Every failed test by name, after the tail below.
    summary: () => failedTests(vitestReport),
  },
  {
    name: "vscode bundle",
    args: ["--filter", "stateward-vscode", "run", "bundle"],
    after: ["tsc"],
    skip: changedMode,
  },
  // The bundled server is what the extension runs when a project has none installed.
  {
    name: "server smoke",
    args: ["exec", "node", "scripts/server-smoke.mjs"],
    after: ["vscode bundle"],
    skip: changedMode,
  },
  // What the public repository would receive: no private reference, secret, local path or broken
  // link. In the gate so a change that would block the release is caught while it is made.
  {
    name: "snapshot",
    args: ["exec", "node", "scripts/publish-snapshot.mjs"],
  },
  // Names that differ only by case, or by .ts and .tsx: one file on macOS and Windows.
  { name: "file names", args: ["exec", "node", "scripts/file-names.mjs"] },
  // stateward checks its own source with the built CLI (docs/quality.md); warm cache: a few seconds.
  {
    name: "self-check",
    args: ["exec", "node", "packages/cli/dist/bin.js", "check", "--max-warnings", "0"],
    after: ["tsc"],
  },
];

const TAIL_LINES = 40;
const pnpm = pnpmCommand();
const started = performance.now();
const outcomes = new Map();

/** Starts a step once the steps it follows have passed; resolves to its outcome. */
function start(step) {
  const promise = (async () => {
    for (const name of step.after ?? []) {
      const before = await outcomes.get(name);
      if (before.state !== "pass" && before.state !== "skip") return { state: "blocked" };
    }
    if (step.skip === true) return { state: "skip" };
    const at = performance.now();
    const result = await runPnpmAsync(step.args, {}, pnpm);
    const seconds = ((performance.now() - at) / 1000).toFixed(1);
    return { state: result.status === 0 ? "pass" : "FAIL", seconds, output: result.output };
  })();
  outcomes.set(step.name, promise);
}
for (const step of steps) start(step);

let failed = false;
for (const step of steps) {
  const outcome = await outcomes.get(step.name);
  if (outcome.state === "skip") continue;
  if (outcome.state === "blocked") {
    console.log(`skip  ${step.name.padEnd(14)} (a step before it failed)`);
    continue;
  }
  console.log(`${outcome.state}  ${step.name.padEnd(14)} ${outcome.seconds}s`);
  if (outcome.state === "FAIL") {
    failed = true;
    console.log(outcome.output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n"));
    const summary = step.summary?.() ?? "";
    if (summary !== "") console.log(`\n${summary}`);
  }
}
console.log(
  `${failed ? "FAIL" : "pass"}  ${(changedMode ? "gate --changed" : "gate").padEnd(14)} ${((performance.now() - started) / 1000).toFixed(1)}s${changedMode ? " (changed files only: run the full gate before handing over)" : ""}`,
);

rmSync(scratch, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
