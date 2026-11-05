import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROLLOUT_FILE,
  RolloutError,
  parseConfig,
  readRollout,
  writeRollout,
} from "../src/internal.js";
import type { Config, FileRule } from "../src/internal.js";
import { plugin } from "./probe-plugin.js";

const noop: FileRule = {
  kind: "file",
  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },
  check: () => undefined,
};

let dir = "";
let config: Config;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-rollout-"));
  const parsed = parseConfig({ plugins: [plugin({ one: noop, two: noop })], rollout: true }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  config = parsed.value;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (): string => path.join(dir, ROLLOUT_FILE);

describe("the rollout file", () => {
  it("round-trips what was written, in order", () => {
    writeRollout(config, ["probe/two", "probe/one"]);
    expect(readRollout(config)).toEqual(["probe/two", "probe/one"]);
    expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({
      version: 1,
      enabled: ["probe/two", "probe/one"],
    });
  });

  it("treats a missing file as no rule enabled yet", () => {
    expect(readRollout(config)).toEqual([]);
  });

  it("replaces the file atomically: no temp file is left beside it", () => {
    writeRollout(config, ["probe/one"]);
    writeRollout(config, ["probe/one", "probe/two"]);
    expect(readdirSync(dir)).toEqual([ROLLOUT_FILE]);
    expect(readRollout(config)).toEqual(["probe/one", "probe/two"]);
  });

  it("names the file and the way out when the JSON is broken", () => {
    writeFileSync(file(), "{ not json");
    expect(() => readRollout(config)).toThrow(RolloutError);
    expect(() => readRollout(config)).toThrow(
      /^stateward\.rollout\.json is not valid JSON \(.+\); fix it, or delete it to start again with `stateward next`$/,
    );
  });

  it.each([
    ["[]", "must be an object like"],
    ['{ "version": 2, "enabled": [] }', "has version 2, but this stateward reads version 1"],
    ['{ "enabled": [] }', "has version undefined"],
    ['{ "version": 1, "enabled": "probe/one" }', '"enabled" must be a list of rule ids'],
    ['{ "version": 1, "enabled": [1] }', '"enabled" must be a list of rule ids'],
    ['{ "version": 1, "enabled": [], "extra": 1 }', 'has an unknown key "extra"'],
    [
      '{ "version": 1, "enabled": ["probe/gone"] }',
      'lists "probe/gone", which is not a rule of your packs; remove "probe/gone" from its "enabled" list; the other rules stay on',
    ],
    ['{ "version": 1, "enabled": ["probe/one", "probe/one"] }', 'lists "probe/one" twice'],
  ])("rejects %s", (text, reason) => {
    writeFileSync(file(), text);
    expect(() => readRollout(config)).toThrow(RolloutError);
    expect(() => readRollout(config)).toThrow(reason);
  });

  it("does not take a file it cannot read for an empty one", () => {
    mkdirSync(file());
    expect(() => readRollout(config)).toThrow(
      /^stateward\.rollout\.json cannot be read \(.+\); fix the file or its permissions, then run again$/,
    );
  });

  it("reports a write that fails, and leaves no temp file", () => {
    mkdirSync(file());
    const write = (): void => {
      writeRollout(config, ["probe/one"]);
    };
    expect(write).toThrow(RolloutError);
    expect(write).toThrow(/cannot be written/);
    expect(readdirSync(dir)).toEqual([ROLLOUT_FILE]);
  });
});
