import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, createChecker, parseConfig } from "@stateward/core";
import type { CheckResult } from "@stateward/core";
import { reactContext } from "../src/index.js";

const dir = fileURLToPath(new URL("./fixtures/hover", import.meta.url));
const src = (name: string): string => path.join(dir, "src", name);

class CacheTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheTestError";
  }
}

function configOf() {
  const parsed = parseConfig({ preset: "recommended", plugins: [reactContext()] }, dir);
  if (!parsed.ok) throw new CacheTestError(parsed.errors.join("\n"));
  return parsed.value;
}

const withoutStats = ({ findings, hidden }: CheckResult) => ({ findings, hidden });

describe("react-context/provider-missing: cached summaries", () => {
  it("gives what a run without a cache gives after edits of files a summary depends on", () => {
    const config = configOf();
    const cached = createChecker({ config, cwd: dir });
    const avatar = readFileSync(src("Avatar.tsx"), "utf8");
    const profile = readFileSync(src("Profile.tsx"), "utf8");
    const main = readFileSync(src("main.tsx"), "utf8");
    // Profile rendered outside Shell, which provides ThemeCtx: Avatar, which Profile renders,
    // needs it, so there is a finding to change.
    const outside: [string, string] = [
      src("main.tsx"),
      main.replace("<Shell>", "<Profile />\n    <Shell>"),
    ];
    const steps: ReadonlyMap<string, string>[] = [
      new Map([outside]),
      // Avatar is no longer a component: Profile's summary of `<Avatar />` changes although
      // Profile.tsx did not.
      new Map([outside, [src("Avatar.tsx"), 'export const Avatar = "img";\n']]),
      new Map([outside]),
      // Text above Profile's declaration: ids stay, offsets in Profile's summary move.
      new Map([outside, [src("Profile.tsx"), `// a note\n${profile}`]]),
      new Map([
        outside,
        [src("Avatar.tsx"), avatar.replace("useRequired(ThemeCtx)", "{ dark: true }")],
      ]),
    ];
    const results = steps.map((overlays) => {
      const result = withoutStats(cached.check(overlays));
      expect(result).toEqual(withoutStats(check({ config, cwd: dir, overlays })));
      return result;
    });
    expect(results[0]?.findings.length).toBeGreaterThan(0);
    expect(results[1]).not.toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[4]).not.toEqual(results[0]);
  });
});
