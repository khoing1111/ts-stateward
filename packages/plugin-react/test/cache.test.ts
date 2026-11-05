import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult } from "@stateward/core";
import { react } from "../src/index.js";
import { fixture } from "./helpers.js";

const dir = fixture("shop");
const file = (name: string): string => path.join(dir, name);
const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

class CacheTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheTestError";
  }
}

describe("react: cached summaries across files", () => {
  it("gives what a run without a cache gives after edits of a hook, of a caller and of package.json", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [react()] }, dir);
    if (!parsed.ok) throw new CacheTestError(parsed.errors.join("\n"));
    const config = parsed.value;
    const cached = createChecker({ config, cwd: dir });
    const cart = readFileSync(file("cart.ts"), "utf8");
    const page = readFileSync(file("CartPage.tsx"), "utf8");
    const steps: ReadonlyMap<string, string>[] = [
      new Map(),
      // `onSave` memoized in the hook: the findings of three callers in other files go.
      new Map([
        [
          file("cart.ts"),
          cart.replace(
            "const onSave = () => api.save(items);",
            "const onSave = useCallback(() => api.save(items), [items]);",
          ),
        ],
      ]),
      new Map(),
      // A caller stops depending on `onSave`: only its own finding goes.
      new Map([[file("CartPage.tsx"), page.replace("}, [onSave]);", "}, []);")]]),
      new Map(),
      // The project turns the React Compiler on: everything goes silent.
      new Map([
        [
          file("package.json"),
          JSON.stringify({ devDependencies: { "react-compiler-runtime": "1.0.0" } }),
        ],
      ]),
      new Map(),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: dir, overlays })));
      return result;
    });
    // Columns.tsx (plain functions) adds 4 dependencies to every step.
    const count = (index: number, rule: string): number =>
      results[index]?.findings.filter((finding) => finding.ruleId === rule).length ?? 0;
    expect(count(0, "react/dependency-changes-every-render")).toBe(14);
    expect(count(1, "react/dependency-changes-every-render")).toBe(11);
    expect(count(3, "react/dependency-changes-every-render")).toBe(13);
    expect(results[5]?.findings).toEqual([]);
    expect(results[2]).toEqual(results[0]);
    expect(results[4]).toEqual(results[0]);
    expect(results[6]).toEqual(results[0]);
  });
});
