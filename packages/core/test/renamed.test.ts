import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyBaseline,
  check,
  parseConfig,
  readBaseline,
  readRollout,
  renamedIdsIn,
  renamedRule,
} from "../src/internal.js";
import type { Config, Plugin, Rule } from "../src/internal.js";

/*
 * 1.2 renamed two rules so that their names say what is wrong. An old id keeps working, with a
 * warning: in the config, in ignore comments, and in the rollout and baseline files. The plugin
 * here stands in for the unions pack: core knows ids only.
 */

class RenamedTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenamedTestError";
  }
}

/** Reports each `switch`. */
const switches: Rule = {
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "cases",
    explain: "d",
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isSwitchStatement(node)) {
        ctx.report({ node, message: "`switch` does not handle a case", hint: "add it" });
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
};
const unionsPack: Plugin = {
  name: "unions",
  description: "unions",
  rules: { "non-exhaustive-switch": switches },
};
const plugins = [unionsPack];
const OLD = "unions/default-hides-cases";
const NOW = "unions/non-exhaustive-switch";

let dir = "";
afterEach(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function project(code: string): string {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-renamed-"));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, module: "NodeNext", noEmit: true, types: [] },
      include: ["*.ts"],
    }),
  );
  writeFileSync(path.join(dir, "a.ts"), code);
  return dir;
}

function configOf(cwd: string, extra: Record<string, unknown> = {}): Config {
  const parsed = parseConfig({ preset: "recommended", plugins, ...extra }, cwd);
  if (!parsed.ok) throw new RenamedTestError(parsed.errors.join("\n"));
  return parsed.value;
}

const SWITCH =
  "export function f(x: 1 | 2): number {\n  switch (x) {\n    default:\n      return 0;\n  }\n}\n";

describe("the rename table", () => {
  it("knows the two rules 1.2 renamed", () => {
    expect(renamedRule(OLD)).toBe(NOW);
    expect(renamedRule("unions/tag-does-not-discriminate")).toBe("unions/ambiguous-discriminant");
    expect(renamedRule(NOW)).toBeUndefined();
  });
});

describe("a config that names an old id", () => {
  it("works under the new id, with one warning per old id", () => {
    const parsed = parseConfig(
      {
        plugins,
        rules: { [OLD]: "warning" },
        overrides: [{ files: ["src/**"], rules: { [OLD]: "off" } }],
      },
      "/work",
      "stateward.config.ts",
    );
    if (!parsed.ok) throw new RenamedTestError(parsed.errors.join("\n"));
    expect(parsed.value.rules).toEqual({ [NOW]: "warning" });
    expect(parsed.value.overrides[0]?.rules).toEqual({ [NOW]: "off" });
    expect(parsed.value.warnings).toEqual([
      "`unions/default-hides-cases` is now `unions/non-exhaustive-switch`; rename it in stateward.config.ts",
    ]);
  });

  it("lets the new id win when both are named", () => {
    const parsed = parseConfig({ plugins, rules: { [OLD]: "off", [NOW]: "error" } }, "/work");
    if (!parsed.ok) throw new RenamedTestError(parsed.errors.join("\n"));
    expect(parsed.value.rules).toEqual({ [NOW]: "error" });
    expect(parsed.value.warnings).toEqual([
      "`unions/default-hides-cases` is now `unions/non-exhaustive-switch`; rename it in your config",
    ]);
  });

  it("follows a rule that moved to another pack, and says so when that pack is missing", () => {
    const moved = "react/provider-value-changes-every-render";
    const now = "react-context/provider-value-changes-every-render";
    const reactPack: Plugin = { name: "react", description: "react", rules: {} };
    const contextPack: Plugin = {
      name: "react-context",
      description: "react-context",
      rules: { "provider-value-changes-every-render": switches },
    };
    const both = parseConfig(
      { plugins: [reactPack, contextPack], rules: { [moved]: "off" } },
      "/w",
    );
    if (!both.ok) throw new RenamedTestError(both.errors.join("\n"));
    expect(both.value.rules).toEqual({ [now]: "off" });
    expect(both.value.warnings).toEqual([
      `\`${moved}\` is now \`${now}\`; rename it in your config`,
    ]);
    const alone = parseConfig({ plugins: [reactPack], rules: { [moved]: "off" } }, "/w");
    if (!alone.ok) throw new RenamedTestError(alone.errors.join("\n"));
    expect(alone.value.rules).toEqual({});
    expect(alone.value.warnings).toEqual([
      `\`${moved}\` is now \`${now}\`, in the react-context pack, which the config does not load; add that pack, or remove the line in your config`,
    ]);
  });

  it("warns about nothing in a config that uses the new ids", () => {
    expect(configOf("/work", { rules: { [NOW]: "off" } }).warnings).toEqual([]);
  });
});

describe("an ignore comment that names an old id", () => {
  it("still covers the finding, and offers the new id", () => {
    const cwd = project(`// stateward-ignore ${OLD}: every value is 0\n${SWITCH}`);
    const result = check({ config: configOf(cwd), cwd });
    expect(result.ignored?.map((entry) => entry.finding.ruleId)).toEqual([NOW]);
    const [notice] = result.findings;
    expect(result.findings).toHaveLength(1);
    if (notice?.kind !== "problem") throw new RenamedTestError("expected a problem");
    expect([notice.ruleId, notice.severity, notice.message, notice.hint]).toEqual([
      "stateward/ignore",
      "warning",
      "`unions/default-hides-cases` is now `unions/non-exhaustive-switch`; rename it in this ignore",
      "change it to `unions/non-exhaustive-switch` (quick fix); the old id still works",
    ]);
    expect(notice.fixes.map((fix) => [fix.title, fix.edits[0]?.newText])).toEqual([
      ["Change to `unions/non-exhaustive-switch`", NOW],
    ]);
  });

  it("says only that it is not needed when it covers nothing", () => {
    const cwd = project(`// stateward-ignore ${OLD}: every value is 0\nexport const a = 1;\n`);
    const result = check({ config: configOf(cwd), cwd });
    expect(result.findings.map((one) => (one.kind === "problem" ? one.message : ""))).toEqual([
      "ignore comment is not needed: `unions/default-hides-cases` finds nothing in the code it covers",
    ]);
  });
});

describe("the rollout and baseline files written before the ids were renamed", () => {
  it("reads an old id in the rollout file as the new one", () => {
    const cwd = project("export {};\n");
    writeFileSync(
      path.join(cwd, "stateward.rollout.json"),
      JSON.stringify({ version: 1, enabled: [OLD] }),
    );
    expect(readRollout(configOf(cwd))).toEqual([NOW]);
  });

  it("matches a baseline entry written under the old id, by rule, file and count", () => {
    const cwd = project(SWITCH);
    const config = configOf(cwd);
    const result = check({ config, cwd });
    expect(result.findings).toHaveLength(1);
    // As 1.1.0 wrote it: the fingerprint hashed the old id.
    const old = { ruleId: OLD, file: "a.ts", fingerprint: "5f0c1e2d3a4b6c7d", message: "m" };
    writeFileSync(
      path.join(cwd, "stateward.baseline.json"),
      JSON.stringify({ version: 2, findings: [old] }),
    );
    const baseline = readBaseline(config);
    expect(baseline?.entries.map((entry) => entry.ruleId)).toEqual([NOW]);
    const view = applyBaseline(baseline, result, {
      configDir: cwd,
      readText: (file) => readFileSync(file, "utf8"),
      ran: new Set([NOW]),
    });
    expect(view.fresh.findings).toEqual([]);
    expect(view.baselined).toHaveLength(1);
  });
});

describe("renamedIdsIn", () => {
  it("finds each old id written as a string, with its line, and leaves longer ids alone", () => {
    const text = [
      "export default {",
      '  rules: { "records/table-type-too-loose": "off",',
      "    'unions/default-hides-cases': \"warning\",",
      '    "records/table-type-too-loose-extra": "off" },',
      "};",
    ].join("\n");
    expect(
      renamedIdsIn(text).map((place) => [
        text.slice(place.start, place.end),
        place.now,
        place.line,
      ]),
    ).toEqual([
      ["records/table-type-too-loose", "records/ambiguous-table", 2],
      ["unions/default-hides-cases", "unions/non-exhaustive-switch", 3],
    ]);
  });
});
