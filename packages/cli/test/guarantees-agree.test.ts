import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createChecker, type StatedGuarantee } from "@stateward/core";
import { loadConfigFile } from "@stateward/core/internal";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

/**
 * `stateward guarantees` and `stateward check` agree on every guarantees fixture: a guarantee is
 * "not proven" exactly when `check` reports an error against it, and it lists exactly those
 * errors. Both run through the CLI, sharing a results cache as a developer's runs do.
 */

const packages = fileURLToPath(new URL("../..", import.meta.url));
const scratchRoot = fileURLToPath(new URL("fixtures", import.meta.url));

type Spec = {
  name: string;
  /** The fixture folder, from `packages/`. */
  dir: string;
  /** The config's pack when the fixture has no config. */
  packs: { imports: string; plugins: string } | undefined;
};

const UNIONS = {
  imports: 'import { unions } from "@stateward/plugin-unions";',
  plugins: "unions()",
};
const ASYNC = {
  imports: 'import { asyncFlow } from "@stateward/plugin-async";',
  plugins: "asyncFlow()",
};
const OWNERSHIP = {
  imports: 'import { ownership } from "@stateward/plugin-ownership";',
  plugins: "ownership()",
};

const FIXTURES: readonly Spec[] = [
  { name: "every kind of guarantee", dir: "cli/test/fixtures/guarantees", packs: undefined },
  {
    name: "an open union",
    dir: "plugin-unions/test/fixtures/non-exhaustive-switch/open-union",
    packs: UNIONS,
  },
  {
    name: "an open union switched on in other files",
    dir: "plugin-unions/test/fixtures/non-exhaustive-switch/open-union-files",
    packs: UNIONS,
  },
  { name: "Pending states", dir: "plugin-async/test/fixtures/pending-trait", packs: ASYNC },
  {
    name: "Pending, written or copied",
    dir: "plugin-async/test/fixtures/pending-written",
    packs: ASYNC,
  },
  {
    name: "Owned values",
    dir: "plugin-ownership/test/fixtures/state-written-outside-owner/owned",
    packs: OWNERSHIP,
  },
  {
    name: "an unused Owned value",
    dir: "plugin-ownership/test/fixtures/guarantees",
    packs: OWNERSHIP,
  },
  {
    name: "Opaque brands",
    dir: "plugin-ownership/test/fixtures/brand-built-outside-owner/opaque",
    packs: OWNERSHIP,
  },
];

const copies: string[] = [];

afterAll(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the fixture with a config, and a results cache folder of its own. */
function prepare(spec: Spec): { dir: string; cache: string } {
  const dir = mkdtempSync(path.join(scratchRoot, ".agree-"));
  copies.push(dir);
  const project = path.join(dir, "project");
  cpSync(path.join(packages, spec.dir), project, { recursive: true });
  if (spec.packs !== undefined) {
    writeFileSync(
      path.join(project, "stateward.config.mjs"),
      `${spec.packs.imports}\nexport default { preset: "recommended", plugins: [${spec.packs.plugins}] };\n`,
    );
  }
  return { dir: project, cache: path.join(dir, "cache") };
}

async function run(argv: readonly string[], cwd: string, cache: string): Promise<unknown> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    cacheDir: () => cache,
  };
  const code: ExitCode = await main(argv, env);
  if (code === 2) throw new Error(`stateward ${argv.join(" ")} could not run: ${stderr}`);
  return JSON.parse(stdout);
}

type Located = { file: string; start: number; end: number };
type CheckFinding = {
  kind: string;
  ruleId: string;
  severity: string;
  message: string;
  location: Located;
  related: { location: Located }[];
};
type Listed = {
  guarantee: string;
  name: string;
  file: string;
  line: number;
  rule: string;
  status: string;
  errors: { file: string; line: number; message: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listOf<T>(value: unknown, key: string, is: (item: unknown) => item is T): T[] {
  const list = isRecord(value) ? value[key] : undefined;
  if (!Array.isArray(list) || !list.every(is)) throw new Error(`unexpected ${key}`);
  return list;
}

function isFinding(value: unknown): value is CheckFinding {
  return isRecord(value) && typeof value.ruleId === "string" && isRecord(value.location);
}

function isListed(value: unknown): value is Listed {
  return isRecord(value) && typeof value.guarantee === "string" && Array.isArray(value.errors);
}

function lineOf(location: Located): number {
  const text = readFileSync(location.file, "utf8");
  return text.slice(0, location.start).split("\n").length;
}

function within(outer: Located, inner: Located): boolean {
  return outer.file === inner.file && inner.start >= outer.start && inner.end <= outer.end;
}

/**
 * Whether a check finding is against a stated guarantee: an error or warning of its rule that
 * names its declaration in a note, or lies in a place the guarantee covers.
 */
function against(finding: CheckFinding, stated: StatedGuarantee): boolean {
  if (finding.kind !== "problem" || finding.severity === "info") return false;
  if (finding.ruleId !== stated.ruleId) return false;
  const declared = stated.location;
  return (
    finding.related.some(
      (note) => note.location.file === declared.file && note.location.start === declared.start,
    ) || stated.covered.some((place) => within(place.location, finding.location))
  );
}

/** The guarantees core states for the project, with their places (the CLI prints lines only). */
async function statedOf(dir: string): Promise<readonly StatedGuarantee[]> {
  const loaded = await loadConfigFile(path.join(dir, "stateward.config.mjs"));
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  const checker = createChecker({
    config: loaded.value,
    cwd: dir,
    rules: { kind: "all" },
    cache: false,
  });
  checker.check();
  return checker.guarantees();
}

/**
 * Every error `check` reports of a rule that proves a guarantee here is against one of them: a
 * finding about a switch, a Provider or a write the list does not cover would leave its guarantee
 * "proven" while `check` fails.
 */
function expectNoneUnaccounted(
  findings: readonly CheckFinding[],
  stated: readonly StatedGuarantee[],
): void {
  const rules = new Set(stated.map((one) => one.ruleId));
  const unaccounted = findings
    .filter((finding) => finding.kind === "problem" && finding.severity === "error")
    .filter((finding) => rules.has(finding.ruleId))
    // A place the rule could not follow to a declaration names no guarantee (M19).
    .filter((finding) => !finding.message.startsWith("not checked:"))
    .filter((finding) => !stated.some((one) => against(finding, one)))
    .map((finding) => `${finding.ruleId}: ${finding.message}`);
  expect(unaccounted).toEqual([]);
}

/** Checks that the two outputs agree, guarantee by guarantee. */
function expectAgreement(
  findings: readonly CheckFinding[],
  listed: readonly Listed[],
  stated: readonly StatedGuarantee[],
  dir: string,
): void {
  expect(listed.length).toBe(stated.length);
  for (const entry of listed) {
    const one = stated.find(
      (candidate) =>
        candidate.guarantee === entry.guarantee &&
        candidate.name === entry.name &&
        path.relative(dir, candidate.location.file) === entry.file &&
        lineOf(candidate.location) === entry.line,
    );
    if (one === undefined) throw new Error(`no stated guarantee for ${entry.name}`);
    const errors = findings
      .filter((finding) => against(finding, one))
      .map((finding) => ({
        file: path.relative(dir, finding.location.file),
        line: lineOf(finding.location),
        message: finding.message,
      }));
    const label = `${entry.name} (${entry.guarantee})`;
    const key = (error: { file: string; line: number; message: string }): string =>
      `${error.file}:${String(error.line).padStart(6, "0")} ${error.message}`;
    expect({
      label,
      unproven: entry.status === "unproven",
      errors: entry.errors.map(key).sort(),
    }).toEqual({ label, unproven: errors.length > 0, errors: errors.map(key).sort() });
  }
}

describe("stateward guarantees agrees with stateward check", { timeout: 60_000 }, () => {
  for (const spec of FIXTURES) {
    it(`on ${spec.name}`, async () => {
      const { dir, cache } = prepare(spec);
      const checked = await run(["check", "--format", "json"], dir, cache);
      const listed = await run(["guarantees", "--format", "json"], dir, cache);
      const stated = await statedOf(dir);
      expect(stated.length).toBeGreaterThan(0);
      expectNoneUnaccounted(listOf(checked, "findings", isFinding), stated);
      expectAgreement(
        listOf(checked, "findings", isFinding),
        listOf(listed, "guarantees", isListed),
        stated,
        dir,
      );
    });
  }

  it("after an edit, from the results cache check wrote, and with --no-cache", async () => {
    const spec = FIXTURES[2];
    if (spec === undefined) throw new Error("no fixture");
    const { dir, cache } = prepare(spec);
    await run(["check", "--format", "json"], dir, cache);
    // Give the open union's last switch a known case to hide, after check cached the file.
    const views = path.join(dir, "views.ts");
    writeFileSync(
      views,
      readFileSync(views, "utf8").replace('    case "shipped":\n      return "truck";\n', ""),
    );
    expect(existsSync(cache)).toBe(true);
    const listed = await run(["guarantees", "--format", "json"], dir, cache);
    const fresh = await run(["guarantees", "--format", "json", "--no-cache"], dir, cache);
    const checked = await run(["check", "--format", "json"], dir, cache);
    expect(listed).toEqual(fresh);
    const stated = await statedOf(dir);
    expectAgreement(
      listOf(checked, "findings", isFinding),
      listOf(listed, "guarantees", isListed),
      stated,
      dir,
    );
    expect(listOf(listed, "guarantees", isListed).map((one) => one.errors.length)).toEqual([4]);
  });
});
