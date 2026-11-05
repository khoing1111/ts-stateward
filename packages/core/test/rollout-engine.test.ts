import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROLLOUT_FILE, RolloutError, check, parseConfig, writeRollout } from "../src/internal.js";
import type { Config, FileRule, RuleSelection } from "../src/internal.js";
import { callProbe, plugin } from "./probe-plugin.js";
import { fixturePath } from "./fixture-path.js";

const project = fixturePath("probe");
const everyFile: FileRule = {
  ...callProbe,
  check: (ctx) => {
    ctx.report({ node: ctx.sourceFile, message: "file", hint: "h" });
  },
};
const rules = { calls: callProbe, files: everyFile };

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-rollout-engine-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function configWith(rollout: boolean, extra: Record<string, unknown> = {}): Config {
  const parsed = parseConfig(
    {
      preset: "recommended",
      plugins: [plugin(rules)],
      tsconfig: path.join(project, "tsconfig.json"),
      rollout,
      ...extra,
    },
    dir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

function ruleIdsOf(config: Config, selection?: RuleSelection): string[] {
  const result = check(
    selection === undefined ? { config, cwd: project } : { config, cwd: project, rules: selection },
  );
  return [...new Set(result.findings.map((finding) => finding.ruleId))].sort();
}

describe("rollout: true", () => {
  it("runs no rule while the rollout file is missing", () => {
    expect(ruleIdsOf(configWith(true))).toEqual([]);
  });

  it("runs only the rules the file lists", () => {
    const config = configWith(true);
    writeRollout(config, ["probe/files"]);
    expect(ruleIdsOf(config)).toEqual(["probe/files"]);
    writeRollout(config, ["probe/files", "probe/calls"]);
    expect(ruleIdsOf(config)).toEqual(["probe/calls", "probe/files"]);
  });

  it("keeps the severity the presets give a listed rule", () => {
    const config = configWith(true, { rules: { "probe/files": "info" } });
    writeRollout(config, ["probe/files"]);
    const result = check({ config, cwd: project });
    expect(result.findings.every((f) => f.kind === "problem" && f.severity === "info")).toBe(true);
  });

  it("does not run a listed rule the config switches off", () => {
    const config = configWith(true, { rules: { "probe/files": "off" } });
    writeRollout(config, ["probe/files"]);
    expect(ruleIdsOf(config)).toEqual([]);
  });

  it("fails the check, naming the file, when the file is broken or lists an unknown rule", () => {
    const config = configWith(true);
    writeFileSync(path.join(dir, ROLLOUT_FILE), "nope");
    expect(() => check({ config, cwd: project })).toThrow(RolloutError);
    writeFileSync(path.join(dir, ROLLOUT_FILE), '{ "version": 1, "enabled": ["probe/gone"] }');
    expect(() => check({ config, cwd: project })).toThrow(
      /stateward\.rollout\.json lists "probe\/gone"/,
    );
  });
});

describe("rollout: false", () => {
  it("ignores the file entirely, even a broken one", () => {
    writeFileSync(path.join(dir, ROLLOUT_FILE), "nope");
    expect(ruleIdsOf(configWith(false))).toEqual(["probe/calls", "probe/files"]);
  });
});

describe("rule selections", () => {
  it("`all` runs every rule of the presets and does not read the file", () => {
    const config = configWith(true);
    writeFileSync(path.join(dir, ROLLOUT_FILE), "nope");
    expect(ruleIdsOf(config, { kind: "all" })).toEqual(["probe/calls", "probe/files"]);
  });

  it("`only` runs that rule alone, whatever the file says", () => {
    const config = configWith(true);
    writeRollout(config, ["probe/calls"]);
    expect(ruleIdsOf(config, { kind: "only", ruleId: "probe/files" })).toEqual(["probe/files"]);
  });
});

describe("group selection and group settings", () => {
  const other: FileRule = { ...everyFile, meta: { ...everyFile.meta, group: "others" } };
  const grouped = plugin({ calls: callProbe, files: everyFile, other });

  function configOf(extra: Record<string, unknown>): Config {
    const parsed = parseConfig(
      {
        preset: "recommended",
        plugins: [grouped],
        tsconfig: path.join(project, "tsconfig.json"),
        ...extra,
      },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return parsed.value;
  }

  it("`group` runs the rules of that group alone, whatever the rollout file says", () => {
    const config = configOf({ rollout: true });
    writeRollout(config, ["probe/other"]);
    expect(ruleIdsOf(config, { kind: "group", groupId: "probe/probes" })).toEqual([
      "probe/calls",
      "probe/files",
    ]);
    expect(ruleIdsOf(config, { kind: "group", groupId: "probe/others" })).toEqual(["probe/other"]);
    expect(ruleIdsOf(config, { kind: "group", groupId: "probe/none" })).toEqual([]);
  });

  it("`group` leaves out a rule of the group that is switched off", () => {
    const config = configOf({ rules: { "probe/files": "off" } });
    expect(ruleIdsOf(config, { kind: "group", groupId: "probe/probes" })).toEqual(["probe/calls"]);
  });

  it("a group set to off stops its rules from running; an explicit rule setting brings one back", () => {
    expect(ruleIdsOf(configOf({ groups: { "probe/probes": "off" } }))).toEqual(["probe/other"]);
    expect(
      ruleIdsOf(configOf({ groups: { "probe/probes": "off" }, rules: { "probe/calls": "error" } })),
    ).toEqual(["probe/calls", "probe/other"]);
  });
});

describe("parseConfig: rollout", () => {
  it("defaults to false, remembers the config folder, and rejects a non-boolean", () => {
    expect(configWith(false)).toMatchObject({ rollout: false, configDir: dir });
    const parsed = parseConfig({ preset: "recommended", plugins: [], rollout: "yes" }, dir);
    expect(parsed).toEqual({ ok: false, errors: ["rollout must be true or false"] });
    expect(parseConfig({ preset: "recommended", plugins: [] }, dir)).toMatchObject({
      ok: true,
      value: { rollout: false },
    });
  });
});
