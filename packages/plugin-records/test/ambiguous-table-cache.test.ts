import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult } from "@stateward/core";
import { records } from "../src/index.js";
import { fixture } from "./helpers.js";

const dir = fixture("ambiguous-table/flagged");
const file = (name: string): string => path.join(dir, name);
const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

class CacheTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheTestError";
  }
}

describe("records/ambiguous-table: cached summaries", () => {
  it("gives what a run without a cache gives after edits of files a summary depends on", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [records()] }, dir);
    if (!parsed.ok) throw new CacheTestError(parsed.errors.join("\n"));
    const config = parsed.value;
    const cached = createChecker({ config, cwd: dir });
    const imported = readFileSync(file("imported.ts"), "utf8");
    const reader = readFileSync(file("imported-reader.ts"), "utf8");
    const steps: ReadonlyMap<string, string>[] = [
      new Map(),
      // Text above the record: its id stays, its location moves.
      new Map([[file("imported.ts"), `// a note\n${imported}`]]),
      // A Map now: the reader's summary of its uses changes although imported-reader.ts did not.
      new Map([
        [
          file("imported.ts"),
          'export const labels = new Map<string, string>([["idle", "Idle"], ["done", "Done"]]);\n',
        ],
      ]),
      new Map(),
      // A write in another file: the record's keys are no longer fixed.
      new Map([[file("imported-reader.ts"), `${reader}\nlabels["new"] = "New";\n`]]),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: dir, overlays })));
      return result;
    });
    expect(results[1]).not.toEqual(results[0]);
    expect(results[2]).not.toEqual(results[0]);
    expect(results[3]).toEqual(results[0]);
    expect(results[4]).not.toEqual(results[0]);
  });
});
