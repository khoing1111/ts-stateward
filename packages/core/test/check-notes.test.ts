import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOOSE_NULLS_FIX, advance, buildPlan, check, parseConfig } from "../src/internal.js";
import type { CheckResult, Config, FileRule, Plugin } from "../src/internal.js";

// User trial 1.0.2 (ts-0001): without the app's packages every React rule was silent and `plan`
// called each "clean"; in a project without `strictNullChecks` the records fixes proved nothing.

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-notes-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A rule that reads a library by its types: it reports every `return` it sees. */
const needsLib: FileRule = {
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "e",
    needsTypes: { library: "Lib", modules: ["some-lib"] },
    fixNeedsStrictNulls: true,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isReturnStatement(node)) ctx.report({ message: "m", hint: "h", node });
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};

const plain: FileRule = {
  ...needsLib,
  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },
};

const pack: Plugin = { name: "lib", description: "lib", rules: { uses: needsLib, other: plain } };

function project(compilerOptions: Record<string, unknown>): Config {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { noEmit: true, ...compilerOptions }, include: ["src"] }),
  );
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "a.ts"), "export function f() {\n  return 1;\n}\n");
  const parsed = parseConfig({ preset: "recommended", plugins: [pack] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

function installTypes(): void {
  const types = path.join(dir, "node_modules", "@types", "some-lib");
  mkdirSync(types, { recursive: true });
  writeFileSync(
    path.join(types, "package.json"),
    '{ "name": "@types/some-lib", "types": "index.d.ts" }',
  );
  writeFileSync(path.join(types, "index.d.ts"), "export declare const x: number;\n");
}

describe("check: rules whose library's types are missing", () => {
  it("names them and why, and says nothing once the types are installed", () => {
    const config = project({});
    expect(check({ config, cwd: dir }).notes?.missingTypes).toEqual([
      {
        library: "Lib",
        reason: "Lib's types are not installed (install the app's dependencies)",
        rules: ["lib/uses"],
      },
    ]);
    installTypes();
    expect(check({ config, cwd: dir }).notes).toBeUndefined();
  });

  it("are never clean in the plan, and `next` does not turn them on as clean", () => {
    const config = project({});
    const quiet: CheckResult = { ...check({ config, cwd: dir }), findings: [] };
    const plan = buildPlan(config, quiet);
    const row = plan.rules.find((one) => one.ruleId === "lib/uses");
    expect(row?.notChecked).toBe("Lib's types are not installed (install the app's dependencies)");
    expect(plan.rules.find((one) => one.ruleId === "lib/other")?.notChecked).toBeUndefined();
    const step = advance(plan, [], false);
    expect(step).toMatchObject({ kind: "turn-on", row: undefined });
    expect(step.kind === "turn-on" ? step.clean.map((one) => one.ruleId) : []).toEqual([
      "lib/other",
    ]);
    expect(advance(plan, ["lib/other"], false)).toMatchObject({ kind: "not-checked" });
  });
});

describe("check: projects without strictNullChecks", () => {
  it("are named once, and the fix line of a rule whose fix needs it says so", () => {
    const config = project({ strictNullChecks: false });
    const result = check({ config, cwd: dir });
    expect(result.notes?.looseNulls).toEqual([path.join(dir, "tsconfig.json")]);
    const hints = new Map(
      result.findings.flatMap((finding) =>
        finding.kind === "problem" ? [[finding.ruleId, finding.hint] as const] : [],
      ),
    );
    expect(hints.get("lib/uses")).toBe(`h\n${LOOSE_NULLS_FIX}`);
    expect(hints.get("lib/other")).toBe("h");
  });

  it("say nothing under `strict` or TypeScript 6's default", () => {
    for (const options of [{ strict: true }, {}]) {
      rmSync(path.join(dir, "src"), { recursive: true, force: true });
      installTypes();
      const result = check({ config: project(options), cwd: dir });
      expect(result.notes).toBeUndefined();
      expect(result.findings.every((finding) => finding.hint === "h")).toBe(true);
    }
  });
});
