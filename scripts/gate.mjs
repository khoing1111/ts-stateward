import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnpmCommand, runPnpm } from "./run.mjs";

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

const steps = [
  { name: "prettier", args: ["exec", "prettier", "--check", "."] },
  // build is tsc -b, then the marker that makes dist/cjs CommonJS. Before eslint: its typed rules
  // read the workspace packages' declarations, which a fresh clone does not have until it builds.
  { name: "tsc", args: ["run", "build"] },
  { name: "eslint", args: ["exec", "eslint", "--max-warnings", "0", "."] },
  { name: "docs:check", args: ["run", "docs:check"] },
  {
    name: "vitest",
    args: [
      "exec",
      "vitest",
      "run",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${vitestReport}`,
    ],
    // Every failed test by name, after the tail below.
    summary: () => failedTests(vitestReport),
  },
  { name: "vscode bundle", args: ["--filter", "stateward-vscode", "run", "bundle"] },
  // The bundled server is what the extension runs when a project has none installed.
  { name: "server smoke", args: ["exec", "node", "scripts/server-smoke.mjs"] },
  // stateward checks its own source with the built CLI (docs/quality.md); warm cache: a few seconds.
  {
    name: "self-check",
    args: ["exec", "node", "packages/cli/dist/bin.js", "check", "--max-warnings", "0"],
  },
];

const TAIL_LINES = 40;
let failed = false;
// The same fallback as pack.mjs: `corepack pnpm` when pnpm is not on PATH.
const pnpm = pnpmCommand();

for (const step of steps) {
  const started = performance.now();
  const result = runPnpm(step.args, {}, pnpm);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const passed = result.status === 0;
  console.log(`${passed ? "pass" : "FAIL"}  ${step.name.padEnd(14)} ${seconds}s`);
  if (!passed) {
    failed = true;
    console.log(result.output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n"));
    const summary = step.summary?.() ?? "";
    if (summary !== "") console.log(`\n${summary}`);
  }
}

rmSync(scratch, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
