import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  createChecker,
  declarationId,
  defineRule,
  definePlugin,
  emptyCache,
  limitFindings,
  parseConfig,
  parseSnapshot,
  proveGuarantees,
  toSnapshot,
} from "../src/internal.js";
import type { Finding, StatedGuarantee } from "../src/internal.js";

/*
 * A finding names the guarantees it is against (`ReportProblem.against` as a node or a symbol), and
 * the proof reads that link whatever the setting, the cap or the cache does to the finding.
 */

const MARKERS = `export type Pending<T> = T & { readonly "__guarantee:pending"?: true };
export type Release<T> = T & { readonly "__guarantee:release"?: true };
`;

const STORE = `import type { Pending } from "./markers.js";
export const store: { saving: Pending<boolean> } = { saving: false };
export function alias(): void {}
export const w = alias;
export const flags: { a: Pending<boolean>; b: Pending<boolean> } = { a: false, b: false };
`;

/** `saving*` reports a problem against the declaration named by the `against` call; `unk*` an unknown. */
const probe = defineRule({
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "e",
    options: {},
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const argument = node.arguments[0];
        const symbol = argument === undefined ? undefined : ctx.types.symbolAt(argument);
        const declaration =
          symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
        if (name === "bad" || name === "worse") {
          ctx.report({
            node,
            message: "against it",
            hint: "h",
            // A symbol, or the declaration node itself.
            against: (name === "bad" ? symbol : declaration) ?? true,
            severity: "warning",
          });
        } else if (name === "origin") {
          const origin = argument === undefined ? undefined : ctx.types.valueOriginOf(argument);
          ctx.report({ node, message: `origin: ${origin?.name ?? "none"}`, hint: "h" });
        } else if (name === "unk") {
          ctx.unknown({
            node,
            message: "not checked: where `x` goes",
            hint: "h",
            ...(declaration === undefined ? {} : { against: declaration }),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});

/** Reports in `use.ts`, against the `store` declared in `store.ts`, naming it by where it is. */
const projectProbe = defineRule({
  kind: "project",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "e",
    options: {},
  },
  summarize: (ctx) => ctx.sourceFile.text.includes("project-probe"),
  check(summaries, ctx) {
    const files = [...summaries.keys()];
    const store = files.find((file) => file.endsWith("store.ts"));
    const use = files.find((file) => summaries.get(file) === true);
    if (store === undefined || use === undefined) return;
    const start = STORE.indexOf("store: {");
    ctx.report({
      message: "against it",
      hint: "h",
      location: { file: use, start: 0, end: 1 },
      against: [{ file: store, start, end: start + 5 }],
    });
  },
});

const plugin = definePlugin({
  name: "g",
  description: "d",
  rules: { probe, projectProbe },
});

let dir = "";
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-linked-"));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  for (const [name, text] of Object.entries({ "markers.ts": MARKERS, ...files })) {
    mkdirSync(path.dirname(path.join(dir, "src", name)), { recursive: true });
    writeFileSync(path.join(dir, "src", name), text);
  }
  return dir;
}

function checkerFor(cwd: string, input: Record<string, unknown> = {}, cache = emptyCache()) {
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin], ...input }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd, cache, uncapped: true });
}

function storeId(cwd: string): string {
  const file = path.join(cwd, "src", "store.ts");
  return declarationId({ file, start: STORE.indexOf("store: {") });
}

describe("a finding that names the declaration it is against", () => {
  it("is linked to it by a symbol or a node, at any severity, and the proof reads it", () => {
    const cwd = project({
      "store.ts": STORE,
      "use.ts":
        'import { store } from "./store.js";\ndeclare function bad(x: unknown): void;\ndeclare function worse(x: unknown): void;\nbad(store);\nworse(store);\n',
    });
    const checker = checkerFor(cwd);
    const result = checker.check();
    const id = storeId(cwd);
    const problems = result.findings.flatMap((one) => (one.kind === "problem" ? [one] : []));
    expect(problems.map((one) => one.guarantees)).toEqual([[id], [id]]);
    // The finding is a warning at most, yet it counts: `against` is set by the link.
    expect(problems.map((one) => one.against)).toEqual([true, true]);
  });

  it("keeps the link through the results cache, written to disk and read back", () => {
    const cwd = project({
      "store.ts": STORE,
      "use.ts":
        'import { store } from "./store.js";\ndeclare function bad(x: unknown): void;\nbad(store);\n',
    });
    const cache = emptyCache();
    const first = checkerFor(cwd, {}, cache).check();
    const second = checkerFor(
      cwd,
      {},
      parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache)))),
    ).check();
    expect(second.findings).toEqual(first.findings);
    expect(first.findings[0]?.kind === "problem" && first.findings[0].guarantees).toEqual([
      storeId(cwd),
    ]);
  });

  it("is never hidden by the cap on findings per rule and file", () => {
    const calls = Array.from({ length: 30 }, () => "bad(store);").join("\n");
    const cwd = project({
      "store.ts": STORE,
      "use.ts": `import { store } from "./store.js";\ndeclare function bad(x: unknown): void;\n${calls}\n`,
    });
    const result = checkerFor(cwd).check();
    const { findings, hidden } = limitFindings(result.findings);
    expect(findings).toHaveLength(30);
    expect(hidden).toEqual([]);
  });

  it("is kept for the proof when an override turns its rule off where it lies", () => {
    const cwd = project({
      "store.ts": STORE,
      "use.ts": '// project-probe\nimport { store } from "./store.js";\nexport { store };\n',
    });
    const result = checkerFor(cwd, {
      overrides: [{ files: ["src/use.ts"], rules: { "g/projectProbe": "off" } }],
    }).check();
    expect(result.findings.filter((one) => one.kind === "problem")).toEqual([]);
    expect(result.silenced?.map((one) => one.kind === "problem" && one.guarantees)).toEqual([
      [storeId(cwd)],
    ]);
  });

  it("makes an unknown finding a place its guarantee is not checked, whatever `unknowns` says", () => {
    const cwd = project({
      "store.ts": STORE,
      "use.ts":
        'import { store } from "./store.js";\ndeclare function unk(x: unknown): void;\nunk(store);\n',
    });
    for (const unknowns of ["info", "warning", "off"]) {
      const checker = checkerFor(cwd, { unknowns });
      const result = checker.check();
      const [unknown] = result.findings.filter((one) => one.kind === "unknown");
      expect(unknown?.kind === "unknown" && unknown.guarantees).toEqual([storeId(cwd)]);
      const stated = checker.guarantees();
      const proofs = proveGuarantees(stated, result.findings, new Set(["g/probe"]));
      const saving = proofs.find((one) => one.stated.name === "saving");
      expect(saving?.status.kind).toBe("unchecked");
    }
  });
});

describe("the declaration a value is, by its type", () => {
  it("is the function an alias or a destructured import holds, and none for a plain value", () => {
    const cwd = project({
      "store.ts": STORE,
      "use.ts":
        'import { w } from "./store.js";\ndeclare function origin(x: unknown): void;\nconst a2 = w;\nconst { alias: a3 } = await import("./store.js");\norigin(w);\norigin(a2);\norigin(a3);\norigin(1);\n',
    });
    const messages = checkerFor(cwd)
      .check()
      .findings.flatMap((one) => (one.kind === "problem" ? [one.message] : []));
    expect(messages).toEqual(["origin: alias", "origin: alias", "origin: alias", "origin: none"]);
  });
});

describe("a stated declaration no plugin lists", () => {
  const unlisted = (checker: ReturnType<typeof checkerFor>): StatedGuarantee[] =>
    checker.guarantees().filter((one) => one.ruleId === "stateward/stated");

  it("is listed by core as not checked, from the written type, with and without the cache", () => {
    const cwd = project({ "store.ts": STORE });
    const cache = emptyCache();
    const checker = checkerFor(cwd, {}, cache);
    checker.check();
    const found = unlisted(checker);
    // The members of both object types, in source order; nothing for `alias` or `w`.
    expect(found.map((one) => [one.name, one.marker, one.guarantee])).toEqual([
      ["saving", "Pending", "pending"],
      ["a", "Pending", "pending"],
      ["b", "Pending", "pending"],
    ]);
    expect(
      found.every(
        (one) =>
          one.unchecked?.[0]?.reason ===
          "`Pending` is stated on a declaration no rule checks: state it where its pack's page shows",
      ),
    ).toBe(true);
    const again = checkerFor(cwd, {}, parseSnapshot(JSON.parse(JSON.stringify(toSnapshot(cache)))));
    again.check();
    expect(unlisted(again)).toEqual(found);
  });

  it("lists nothing when no file states a marker, and not the marker's own definition", () => {
    const cwd = project({
      "plain.ts": "export const x: { saving: boolean } = { saving: false };\n",
    });
    const checker = checkerFor(cwd);
    checker.check();
    // `markers.ts` defines the markers (`Pending<T> = T & { … }`); it states nothing.
    expect(unlisted(checker)).toEqual([]);
  });
});

describe("proveGuarantees over a finding the engine linked", () => {
  it("reads the guarantee as not proven when the finding names it", () => {
    const finding: Finding = {
      kind: "problem",
      ruleId: "g/probe",
      severity: "info",
      message: "m",
      hint: "h",
      location: { file: "/p/a.ts", start: 0, end: 1 },
      related: [],
      fixes: [],
      guarantees: ["/p/b.ts#5"],
    };
    const stated: StatedGuarantee = {
      guarantee: "pending",
      marker: "Pending",
      name: "n",
      declaration: "/p/b.ts#5",
      location: { file: "/p/b.ts", start: 5, end: 9 },
      ruleId: "g/probe",
      promise: "p",
      covers: { one: "place", many: "places" },
      covered: [{ name: "x", location: { file: "/p/a.ts", start: 20, end: 30 } }],
    };
    expect(proveGuarantees([stated], [finding], new Set(["g/probe"]))[0]?.status.kind).toBe(
      "unproven",
    );
  });
});
