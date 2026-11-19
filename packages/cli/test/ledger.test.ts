import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createChecker } from "@stateward/core";
import type { CheckResult, Ledger } from "@stateward/core";
import {
  activeRuleIds,
  emptyCache,
  loadConfigFile,
  proveGuarantees,
} from "@stateward/core/internal";
import { serviceReferences } from "@stateward/core/testing";
import { formatGuaranteesJson } from "../src/guarantees.js";
import { prepare, removeCopies, root, run } from "./adversarial-project.js";

/**
 * The reference ledger over the adversarial cases of the guarantees whose proofs read it (`Owned`,
 * `Release`, `RequiredContext`, `SingleProvider`, `Stable`, `Pending`, the typed flows of
 * `Opaque`, `OpenUnion` and `Pending` holders, and the JSDoc tags `@neverRejects`, `@throws`,
 * `@initial` and `@final`):
 *
 * - the oracle: the language service's find-references, for each stated declaration, finds no
 *   reference the ledger lacks;
 * - determinism: a cold run, a run from the results cache and the editor's sliced pass give the
 *   same guarantees;
 * - the cache: an edit to the declaring file alone changes an importer's ledger.
 */

afterAll(removeCopies);

/** The groups of cases whose guarantees the ledger serves: one test each, so each fits its time. */
const GROUPS = [
  "owned",
  "release",
  "required-context",
  "single-provider",
  "stable",
  "pending",
  "react",
  "opaque",
  "open-union",
  "tags",
];

/** Every case of a group, good twins included. */
function casesOf(group: string): string[] {
  return readdirSync(path.join(root, group))
    .filter((name) => name !== "_shared")
    .sort()
    .map((name) => `${group}/${name}`);
}

async function checkerFor(project: string, cache: boolean) {
  const loaded = await loadConfigFile(path.join(project, "stateward.config.mjs"));
  if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
  const config = loaded.value;
  const checker = createChecker({
    config,
    cwd: project,
    rules: { kind: "all" },
    cache: cache ? emptyCache() : false,
    uncapped: true,
  });
  return { config, checker };
}

function ledgerOf(result: CheckResult): Ledger {
  if (result.ledger === undefined) throw new Error("a full check keeps a ledger");
  return result.ledger;
}

describe("the reference ledger", { timeout: 120_000 }, () => {
  for (const group of GROUPS) {
    it(`holds every reference the language service finds, for each stated declaration: ${group}`, async () => {
      const CASES = casesOf(group);
      const missing: string[] = [];
      let declarations = 0;
      let references = 0;
      for (const dir of CASES) {
        const { project } = prepare(dir);
        const { checker } = await checkerFor(project, false);
        const ledger = ledgerOf(checker.check());
        const traits = new Set(ledger.traits);
        const listed = checker
          .guarantees()
          .filter(
            (one) =>
              traits.has(one.guarantee) &&
              (one.source === undefined || one.source.kind === "marker"),
          );
        const ids = new Set(ledger.refs.map((ref) => ref.id));
        const wanted = new Map<string, { file: string; start: number }>();
        for (const one of [
          ...listed.map((guarantee) => guarantee.declaration),
          ...ledger.refs.map((ref) => ref.declaration),
        ]) {
          const at = one.lastIndexOf("#");
          wanted.set(one, { file: one.slice(0, at), start: Number(one.slice(at + 1)) });
        }
        declarations += wanted.size;
        const found = serviceReferences(path.join(project, "tsconfig.json"), [...wanted.values()]);
        for (const [declaration, list] of found) {
          references += list.length;
          for (const reference of list) {
            const id = `${reference.file}#${String(reference.start)}`;
            if (!ids.has(id)) {
              const text = readFileSync(reference.file, "utf8");
              const line = text.slice(0, reference.start).split("\n").length;
              missing.push(
                `${dir}: ${path.basename(reference.file)}:${String(line)} refers to ${path.basename(declaration)}`,
              );
            }
          }
        }
      }
      // Every case states at least one declaration, and refers to them more often than that.
      expect(declarations).toBeGreaterThanOrEqual(CASES.length);
      // A tagged function is often named only by its tag, which find-references does not list.
      expect(references).toBeGreaterThan(group === "tags" ? 0 : declarations);
      expect(missing).toEqual([]);
    });
  }

  for (const group of GROUPS) {
    it(`gives the same guarantees cold, from the cache and in the editor's sliced pass: ${group}`, async () => {
      for (const dir of casesOf(group)) {
        const { project, cache } = prepare(dir);
        const cold = await run(["guarantees", "--format", "json", "--no-cache"], project, cache);
        const first = await run(["guarantees", "--format", "json"], project, cache);
        const warm = await run(["guarantees", "--format", "json"], project, cache);
        expect(first.stdout, dir).toBe(cold.stdout);
        expect(warm.stdout, dir).toBe(cold.stdout);
        // The language server's full pass: a checker kept for the session, run in slices.
        const { config, checker } = await checkerFor(project, true);
        const outcome = await checker.checkInSlices(new Map(), { cancelled: () => false });
        if (outcome.kind !== "done") throw new Error("the sliced pass did not finish");
        const raw = outcome.result;
        const proofs = proveGuarantees(
          checker.guarantees(),
          raw.findings,
          activeRuleIds(config, { kind: "configured" }),
          {
            ignored: raw.ignored ?? [],
            ledger: ledgerOf(raw),
            ruleOffAt: (ruleId, file) => checker.ruleOffAt(ruleId, file),
          },
        );
        const editor = formatGuaranteesJson(proofs, (location) => ({
          file: path.relative(project, location.file).split(path.sep).join("/"),
          line: readFileSync(location.file, "utf8").slice(0, location.start).split("\n").length,
        }));
        expect(`${editor}\n`, dir).toBe(cold.stdout);
      }
    });
  }

  it("changes an importer's ledger when only the declaring file changes", async () => {
    const { project } = prepare("owned/class-field-good");
    const { checker } = await checkerFor(project, true);
    const session = path.join(project, "src", "session.ts");
    const importer = path.join(project, "src", "a.ts");
    const refsOf = (result: CheckResult) =>
      ledgerOf(result).refs.filter((ref) => ref.location.file === importer);
    const before = refsOf(checker.check());
    expect(before.map((ref) => ref.form)).toEqual(["import", "read"]);
    const text = readFileSync(session, "utf8");
    // A comment above moves the declaration: its id in the importer's ledger moves with it.
    const moved = refsOf(checker.check(new Map([[session, `// the session\n${text}`]])));
    expect(moved.map((ref) => ref.form)).toEqual(["import", "read"]);
    expect(moved[0]?.declaration).not.toBe(before[0]?.declaration);
    // Only the marker removed: nothing in the importer refers to a stated declaration any more.
    const unmarked = text.replace(/Owned<(\{[^>]*\})>/s, "$1");
    expect(unmarked).not.toBe(text);
    expect(refsOf(checker.check(new Map([[session, unmarked]])))).toEqual([]);
  });

  it("changes an importer's flows of a brand when only its marker changes", async () => {
    const { project } = prepare("opaque/generic-call");
    const { checker } = await checkerFor(project, true);
    const declaring = path.join(project, "src", "order-id.ts");
    const importer = path.join(project, "src", "a.ts");
    const refsOf = (result: CheckResult) =>
      ledgerOf(result)
        .refs.filter((ref) => ref.location.file === importer)
        .map((ref) => `${ref.trait} ${ref.form}${ref.via === undefined ? "" : ` ${ref.via}`}`);
    expect(refsOf(checker.check())).toEqual([
      "opaque import",
      "opaque type",
      "opaque type",
      "opaque produced generic-call",
    ]);
    const text = readFileSync(declaring, "utf8");
    const unmarked = text.replace('Opaque<string, "OrderId">', "string");
    expect(unmarked).not.toBe(text);
    expect(refsOf(checker.check(new Map([[declaring, unmarked]])))).toEqual([]);
  });

  it("changes an importer's ledger of a tagged prop when only its tag changes", async () => {
    const { project } = prepare("tags/never-rejects-prop");
    const { checker } = await checkerFor(project, true);
    const declaring = path.join(project, "src", "search.tsx");
    const importer = path.join(project, "src", "a.tsx");
    const refsOf = (result: CheckResult) =>
      ledgerOf(result)
        .refs.filter((ref) => ref.location.file === importer)
        .map((ref) => `${ref.trait} ${ref.form}`);
    expect(refsOf(checker.check())).toEqual([
      "@neverRejects jsx-attribute",
      "@neverRejects jsx-attribute",
    ]);
    const text = readFileSync(declaring, "utf8");
    const untagged = text.replace(" @neverRejects", "");
    expect(untagged).not.toBe(text);
    expect(refsOf(checker.check(new Map([[declaring, untagged]])))).toEqual([]);
  });

  it("changes an importer's ledger of a context when only its marker changes", async () => {
    const { project } = prepare("stable/provider-alias-good");
    const { checker } = await checkerFor(project, true);
    const contexts = path.join(project, "src", "contexts.ts");
    const importer = path.join(project, "src", "a.tsx");
    const refsOf = (result: CheckResult) =>
      ledgerOf(result)
        .refs.filter((ref) => ref.location.file === importer)
        .map((ref) => `${ref.trait} ${ref.form}`);
    expect(refsOf(checker.check())).toEqual(["stable import", "stable read", "stable read"]);
    const text = readFileSync(contexts, "utf8");
    const unmarked = text.replace(" & Stable", "");
    expect(unmarked).not.toBe(text);
    expect(refsOf(checker.check(new Map([[contexts, unmarked]])))).toEqual([]);
  });
});
