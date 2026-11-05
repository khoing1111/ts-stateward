import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

/*
 * The fixture lives in a work folder inside the package so its config finds
 * @stateward/plugin-unions and @stateward/plugin-records. Findings: if-chain 1, lookup 1, default-hides-cases 2,
 * table-type-too-loose and tag-does-not-discriminate 0 (the plan order); the rule ids are written out so the order is visible.
 */
const ORDER = [
  "records/duplicate-key",
  "records/table-type-too-loose",
  "unions/if-chain-misses-case",
  "records/lookup-misses-key",
  "unions/default-hides-cases",
  "unions/tag-does-not-discriminate",
] as const;

let work = "";

beforeEach(() => {
  work = mkdtempSync(path.join(fixtures, "tmp-"));
  cpSync(path.join(fixtures, "adopt"), work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd: work,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

const rolloutPath = (): string => path.join(work, "stateward.rollout.json");
const enabledOnDisk = (): unknown => JSON.parse(readFileSync(rolloutPath(), "utf8"));
const writeEnabled = (enabled: readonly string[]): void => {
  writeFileSync(rolloutPath(), JSON.stringify({ version: 1, enabled }));
};
const ruleIdsIn = (stdout: string): string[] => {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) return [];
  const { findings } = parsed;
  if (!Array.isArray(findings)) return [];
  const ids = findings.flatMap((finding: unknown) =>
    typeof finding === "object" && finding !== null && "ruleId" in finding
      ? [String(finding.ruleId)]
      : [],
  );
  return [...new Set(ids)];
};

describe("stateward plan", { timeout: 20_000 }, () => {
  it("prints every rule with its findings, in the suggested order, and what to do next", async () => {
    const { code, stdout, stderr } = await run(["plan"]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const lines = stdout.split("\n");
    expect(lines[0]).toMatch(/^order {2}rule {30}findings {2}fixable {2}protects$/);
    // Rules sit under their group; groups come in the order of their first rule, and the order
    // numbers stay the plan's own (rule 5 is the second of "cases").
    const shape = lines.slice(1, 11).map((line) => line.split(/\s{2,}/).slice(0, 4));
    expect(shape).toEqual([
      [""],
      ["records/keys"],
      ["1", ORDER[0], "0", "0"],
      ["2", ORDER[1], "0", "0"],
      ["4", ORDER[3], "1", "0"],
      [""],
      ["unions/cases"],
      ["3", ORDER[2], "1", "0"],
      ["5", ORDER[4], "2", "2"],
      ["6", ORDER[5], "0", "0"],
    ]);
    expect(lines[3]).toContain("(nothing to fix, turns on clean)");
    expect(lines[10]).toContain("(nothing to fix, turns on clean)");
    expect(lines.slice(11)).toEqual([
      "",
      "on: none yet",
      `next: run \`stateward next\` to turn on rule 3 (${ORDER[2]}).`,
      "",
    ]);
    expect(existsSync(rolloutPath())).toBe(false);
  });

  it("gives the same as data with --format json, ignoring the rollout file", async () => {
    writeEnabled([ORDER[4]]);
    const { code, stdout } = await run(["plan", "--format", "json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      rollout: true,
      enabled: [ORDER[4]],
      rules: [
        {
          order: 1,
          ruleId: ORDER[0],
          group: "records/keys",
          tier: "core",
          findings: 0,
          fixable: 0,
        },
        { order: 2, ruleId: ORDER[1], group: "records/keys", findings: 0 },
        { order: 3, ruleId: ORDER[2], group: "unions/cases", findings: 1 },
        { order: 4, ruleId: ORDER[3], findings: 1 },
        { order: 5, ruleId: ORDER[4], findings: 2 },
        { order: 6, ruleId: ORDER[5], tier: "coverage", findings: 0 },
      ],
      next: `fix the 2 findings of \`${ORDER[4]}\`, then run \`stateward next\``,
    });
  });

  it("says what to do when rollout is off", async () => {
    writeFileSync(
      path.join(work, "stateward.config.mjs"),
      'import { unions } from "@stateward/plugin-unions";\nimport { records } from "@stateward/plugin-records";\nexport default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"] };\n',
    );
    const { stdout } = await run(["plan"]);
    expect(stdout).toContain("on: every rule (rollout is off)");
    expect(stdout).toContain(
      "set `rollout: true` in your stateward config, then run `stateward next`",
    );
  });

  it("exits 2 and names the file when the rollout file is broken", async () => {
    writeFileSync(rolloutPath(), "{");
    const { code, stdout, stderr } = await run(["plan"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/^stateward: stateward\.rollout\.json is not valid JSON/);
  });
});

describe("stateward check with rollout", { timeout: 40_000 }, () => {
  it("says nothing was checked while no rule is on, instead of a bare No problems", async () => {
    const { code, stdout } = await run(["check"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(
      /^rollout: no rule is on yet, so nothing was checked; run `stateward next` to turn on the first\n\n/,
    );
  });

  it("says how many rules are on", async () => {
    writeEnabled([ORDER[2]]);
    const { stdout } = await run(["check"]);
    expect(stdout).toMatch(
      /^rollout: 1 rule on \(stateward\.rollout\.json\); `stateward plan` shows the rest\n/,
    );
  });
});

describe("stateward next", { timeout: 40_000 }, () => {
  it("turns on the first rule with findings, every clean rule with it, and says what it shows", async () => {
    const { code, stdout } = await run(["next"]);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        `also on, nothing to fix: ${ORDER[0]}, ${ORDER[1]}, ${ORDER[5]}`,
        `on: ${ORDER[2]} (1 finding, 0 fixable)`,
        "An if / else if chain over a union handles every case, so a value added later fails to compile.",
        "run stateward check to see them",
        "",
      ].join("\n"),
    );
    expect(enabledOnDisk()).toEqual({
      version: 1,
      enabled: [ORDER[0], ORDER[1], ORDER[5], ORDER[2]],
    });
  });

  it("makes check show only the rules turned on", async () => {
    expect((await run(["check", "--format", "json"])).stdout).toContain('"findings": []');
    await run(["next"]);
    expect(ruleIdsIn((await run(["check", "--format", "json"])).stdout)).toEqual([ORDER[2]]);
  });

  it("refuses, exit 1, while the rule turned on last still has findings", async () => {
    await run(["next"]);
    const { code, stdout, stderr } = await run(["next"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `stateward: \`${ORDER[2]}\` still has 1 finding; fix them, or run \`stateward next --anyway\` to move on, or \`stateward baseline\` to accept them\n`,
    );
    expect(enabledOnDisk()).toEqual({
      version: 1,
      enabled: [ORDER[0], ORDER[1], ORDER[5], ORDER[2]],
    });
  });

  it("moves on with --anyway", async () => {
    await run(["next"]);
    const { code, stdout } = await run(["next", "--anyway"]);
    expect(code).toBe(0);
    expect(stdout).toContain(`on: ${ORDER[3]} (1 finding, 0 fixable)`);
    expect(enabledOnDisk()).toEqual({
      version: 1,
      enabled: [ORDER[0], ORDER[1], ORDER[5], ORDER[2], ORDER[3]],
    });
  });

  it("moves on without --anyway once the last rule has no findings", async () => {
    writeEnabled([ORDER[5]]);
    const { code, stdout } = await run(["next"]);
    expect(code).toBe(0);
    expect(stdout).toContain(`on: ${ORDER[2]} (1 finding, 0 fixable)`);
  });

  it("says every rule is on when none is left, and writes nothing", async () => {
    writeEnabled([...ORDER]);
    const before = readFileSync(rolloutPath(), "utf8");
    const { code, stdout } = await run(["next"]);
    expect(code).toBe(0);
    expect(stdout).toBe("every rule is on; you can remove stateward.rollout.json and `rollout`\n");
    expect(readFileSync(rolloutPath(), "utf8")).toBe(before);
  });

  it("needs rollout: true, and says where to put it", async () => {
    writeFileSync(
      path.join(work, "stateward.config.mjs"),
      'import { unions } from "@stateward/plugin-unions";\nimport { records } from "@stateward/plugin-records";\nexport default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"] };\n',
    );
    const { code, stderr } = await run(["next"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^stateward: turn on `rollout: true` in stateward\.config\.mjs first: /);
    expect(existsSync(rolloutPath())).toBe(false);
  });

  it("exits 2 on a rollout file that lists an unknown rule, and does not touch it", async () => {
    writeEnabled(["guards/gone"]);
    const { code, stderr } = await run(["next"]);
    expect(code).toBe(2);
    expect(stderr).toContain('stateward.rollout.json lists "guards/gone", which is not a rule');
    expect(enabledOnDisk()).toEqual({ version: 1, enabled: ["guards/gone"] });
  });
});

describe("stateward check with a rollout file", { timeout: 20_000 }, () => {
  it("exits 2, naming the file, when it cannot be read", async () => {
    writeFileSync(rolloutPath(), '{ "version": 9, "enabled": [] }');
    const { code, stderr } = await run(["check"]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward.rollout.json has version 9");
  });
});

describe("stateward check --rule", { timeout: 20_000 }, () => {
  it("runs that rule alone, pretty and JSON, whatever the rollout says", async () => {
    writeEnabled([ORDER[2]]);
    const pretty = await run(["check", "--rule", ORDER[4]]);
    expect(pretty.code).toBe(1);
    expect(pretty.stdout).toContain(`error[${ORDER[4]}]`);
    expect(pretty.stdout).not.toContain(`[${ORDER[2]}]`);
    expect(pretty.stdout).toContain("2 errors in 1 file");
    const json = await run(["check", "--rule", ORDER[4], "--format", "json"]);
    expect(ruleIdsIn(json.stdout)).toEqual([ORDER[4]]);
  });

  it("exits 2 for an unknown rule and lists the known ones", async () => {
    const { code, stdout, stderr } = await run(["check", "--rule", "guards/nope"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `stateward: unknown rule "guards/nope"; known rules: ${[...ORDER, "records/keyed-maps-out-of-sync"].sort().join(", ")}\n`,
    );
  });

  it("exits 2 for a rule the config switches off, and says how to turn it on", async () => {
    writeFileSync(
      path.join(work, "stateward.config.mjs"),
      `import { unions } from "@stateward/plugin-unions";\nimport { records } from "@stateward/plugin-records";\nexport default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"], rules: { "${ORDER[2]}": "off" } };\n`,
    );
    const { code, stderr } = await run(["check", "--rule", ORDER[2]]);
    expect(code).toBe(2);
    expect(stderr).toContain(`${ORDER[2]} is switched off in your config`);
  });
});

describe("an old id from the betas", { timeout: 20_000 }, () => {
  it("is an unknown rule or group, like any other", async () => {
    const rule = await run(["check", "--rule", "guards/no-default-on-union-switch"]);
    expect(rule.stderr).toContain('unknown rule "guards/no-default-on-union-switch"');
    expect(rule.stderr).toContain("known rules: ");
    const group = await run(["check", "--group", "guards/markers"]);
    expect(group.stderr).toContain('unknown group "guards/markers"; known groups: ');
    const explained = await run(["explain", "guards/no-default-on-union-switch"]);
    expect(explained.code).not.toBe(0);
    expect(explained.stderr).toContain('unknown rule "guards/no-default-on-union-switch"');
  });
});

describe("stateward check --group", { timeout: 20_000 }, () => {
  it("runs the rules of that group alone, whatever the rollout says", async () => {
    writeEnabled([ORDER[3]]);
    const pretty = await run(["check", "--group", "unions/cases"]);
    expect(pretty.code).toBe(1);
    expect(pretty.stdout).toContain(`[${ORDER[4]}]`);
    expect(pretty.stdout).toContain(`[${ORDER[2]}]`);
    expect(pretty.stdout).not.toContain(`[${ORDER[3]}]`);
    expect(pretty.stdout).not.toContain("rollout:");
    const json = await run(["check", "--group", "records/keys", "--format", "json"]);
    expect(ruleIdsIn(json.stdout)).toEqual([ORDER[3]]);
  });

  it("combines with --max", async () => {
    const { code, stdout } = await run(["check", "--group", "unions/cases", "--max", "1"]);
    expect(code).toBe(1);
    expect(stdout).toContain("more");
  });

  it("exits 2 for an unknown group and lists the known ones", async () => {
    const { code, stdout, stderr } = await run(["check", "--group", "guards/nope"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      'stateward: unknown group "guards/nope"; known groups: records/keys, unions/cases\n',
    );
  });

  it("exits 2 when the config switches the whole group off", async () => {
    writeFileSync(
      path.join(work, "stateward.config.mjs"),
      'import { unions } from "@stateward/plugin-unions";\nimport { records } from "@stateward/plugin-records";\nexport default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"], groups: { "unions/cases": "off" } };\n',
    );
    const { code, stderr } = await run(["check", "--group", "unions/cases"]);
    expect(code).toBe(2);
    expect(stderr).toContain("every rule of unions/cases is switched off in your config");
  });

  it("turns a group down to a warning through the config", async () => {
    writeFileSync(
      path.join(work, "stateward.config.mjs"),
      'import { unions } from "@stateward/plugin-unions";\nimport { records } from "@stateward/plugin-records";\nexport default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"], groups: { "unions/cases": "warning" } };\n',
    );
    const { code, stdout } = await run(["check", "--group", "unions/cases"]);
    expect(code).toBe(0);
    expect(stdout).toContain(`warning[${ORDER[4]}]`);
  });
});

describe("stateward init on a project with many findings", { timeout: 20_000 }, () => {
  /** A project with `count` switches that hide a case behind a default, and no config yet. */
  function legacyProject(count: number): void {
    rmSync(path.join(work, "stateward.config.mjs"));
    // As in an app that installed stateward: the generated config imports "stateward".
    mkdirSync(path.join(work, "node_modules"));
    // A directory link needs no privilege on Windows as a junction (which takes an absolute target).
    symlinkSync(
      path.resolve(fixtures, "..", ".."),
      path.join(work, "node_modules", "stateward"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const switches = Array.from(
      { length: count },
      (_, index) =>
        `export function f${String(index)}(s: Status): string {\n  switch (s) {\n    case "idle":\n      return "i";\n    default:\n      return "o";\n  }\n}\n`,
    );
    writeFileSync(
      path.join(work, "src", "more.ts"),
      ['import type { Status } from "./status.js";', "", ...switches].join("\n"),
    );
  }

  it("turns rollout on in the generated config and says why, past 20 problems", async () => {
    legacyProject(25);
    const { code, stdout } = await run(["init", "--packs", "unions,records"]);
    expect(code).toBe(0);
    expect(readFileSync(path.join(work, "stateward.config.ts"), "utf8")).toBe(
      [
        'import { defineConfig } from "stateward";',
        'import { unions } from "@stateward/plugin-unions";',
        'import { records } from "@stateward/plugin-records";',
        "",
        "export default defineConfig({",
        "  plugins: [unions(), records()],",
        "  // turns on the recommended rules of these packs; remove it to choose rules one by one",
        '  preset: "recommended",',
        "  rollout: true,",
        "});",
        "",
      ].join("\n"),
    );
    expect(stdout).toContain(
      "  29 findings across 3 rules: turning on one rule at a time (stateward plan, stateward next)",
    );
    expect(stdout).toContain("Then run: stateward plan");
    // The generated config works: plan reads it and nothing is on yet.
    const plan = await run(["plan"]);
    expect(plan.code).toBe(0);
    expect(plan.stdout).toContain("on: none yet");
  });

  it("leaves rollout off at exactly 20 problems (4 in the fixture, 16 more)", async () => {
    legacyProject(16);
    const { stdout } = await run(["init", "--packs", "unions,records"]);
    expect(readFileSync(path.join(work, "stateward.config.ts"), "utf8")).not.toContain("rollout");
    expect(stdout).not.toContain("one rule at a time");
    expect(stdout).toContain("Then run: stateward check");
  });

  it("says nothing about it when the packs it imports cannot be loaded", async () => {
    legacyProject(25);
    const { stdout } = await run(["init", "--packs", "reducers"]);
    expect(readFileSync(path.join(work, "stateward.config.ts"), "utf8")).not.toContain("rollout");
    expect(stdout).not.toContain("one rule at a time");
  });
});
