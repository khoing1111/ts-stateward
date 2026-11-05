import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult } from "@stateward/core";
import { reducers } from "../src/index.js";
import { fixture } from "./helpers.js";

const dir = fixture("graph/checkout");
const file = (name: string): string => path.join(dir, name);
const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

class CacheTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheTestError";
  }
}

describe("machines: cached summaries", () => {
  it("gives what a run without a cache gives after edits of the reducer and of a file it depends on", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [reducers()] }, dir);
    if (!parsed.ok) throw new CacheTestError(parsed.errors.join("\n"));
    const config = parsed.value;
    const cached = createChecker({ config, cwd: dir });
    const reducer = readFileSync(file("reducer.ts"), "utf8");
    const initial = readFileSync(file("initial.ts"), "utf8");
    const steps: ReadonlyMap<string, string>[] = [
      new Map(),
      // A way out of "paymentFailed": the dead end is gone.
      new Map([
        [
          file("reducer.ts"),
          reducer
            .replace(
              '    case "cancel":',
              '    case "paymentFailed":\n      return state;\n    case "cancel":',
            )
            .replace(
              '      if (state.status !== "cart") return state;\n      return { status: "cancelled" };',
              '      if (state.status === "paid") return state;\n      return { status: "cancelled" };',
            ),
        ],
      ]),
      new Map(),
      // The start moves to "review" in another file; the reducer did not change.
      new Map([
        [
          file("initial.ts"),
          initial.replace(
            'status: "cart", items: []',
            'status: "review", items: [], address: { street: "", city: "" }',
          ),
        ],
      ]),
      new Map(),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: dir, overlays })));
      return result;
    });
    const rules = (index: number) =>
      results[index]?.findings.map((finding) => finding.ruleId) ?? [];
    expect(rules(0)).toEqual(["reducers/state-cannot-leave", "reducers/state-unreachable"]);
    expect(results[2]).toEqual(results[0]);
    expect(results[4]).toEqual(results[0]);
    expect(results[1]).not.toEqual(results[0]);
    expect(results[3]).not.toEqual(results[0]);
  });
});
