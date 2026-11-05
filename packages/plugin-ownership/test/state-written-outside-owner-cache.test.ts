import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult } from "@stateward/core";
import { ownership } from "../src/index.js";
import { fixture } from "./helpers.js";

const dir = fixture("state-written-outside-owner/flagged");
const file = (name: string): string => path.join(dir, name);
const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

class CacheTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheTestError";
  }
}

describe("ownership/state-written-outside-owner: cached summaries", () => {
  it("gives what a run without a cache gives after edits of files a summary depends on", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [ownership()] }, dir);
    if (!parsed.ok) throw new CacheTestError(parsed.errors.join("\n"));
    const config = parsed.value;
    const cached = createChecker({ config, cwd: dir });
    const owner = readFileSync(file("settings.ts"), "utf8");
    const steps: ReadonlyMap<string, string>[] = [
      new Map(),
      // Text above the declaration: its id stays, its location moves; theme.ts did not change.
      new Map([[file("settings.ts"), `// a note\n${owner}`]]),
      // `settings` is no longer shared state (a call result): theme.ts did not change either.
      new Map([
        [
          file("settings.ts"),
          owner.replace(
            'export const settings = { theme: "light", fontSize: 14, raw: {} as Record<string, string> };',
            'export const settings = Object.freeze({ theme: "light", fontSize: 14, raw: {} as Record<string, string> });',
          ),
        ],
      ]),
      new Map(),
      // `reset` only reads its parameter now: caller.ts and relayed.ts did not change.
      new Map([
        [
          file("reset.ts"),
          "export function reset(target: { theme: string }): string {\n  return target.theme;\n}\n",
        ],
      ]),
      new Map(),
      // The writing file itself is edited: its change is gone.
      new Map([[file("theme.ts"), "export const unrelated = 1;\n"]]),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: dir, overlays })));
      return result;
    });
    expect(results[1]).not.toEqual(results[0]);
    expect(results[2]).not.toEqual(results[0]);
    expect(results[2]?.findings.length).toBeLessThan(results[0]?.findings.length ?? 0);
    expect(results[3]).toEqual(results[0]);
    expect(results[4]?.findings.length).toBe((results[0]?.findings.length ?? 0) - 2);
    expect(results[5]).toEqual(results[0]);
    expect(results[6]?.findings.length).toBeLessThan(results[0]?.findings.length ?? 0);
  });
});
