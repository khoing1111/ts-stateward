import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const SWITCH_RULE = "unions/default-hides-cases";
const HINT =
  "your `exclude` replaces the default list, so 1 file matching `*.test.*` is checked now; add `...defaults.exclude` to skip them";

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

function writeConfig(lines: readonly string[]): void {
  writeFileSync(
    path.join(work, "stateward.config.mjs"),
    [
      'import { defaults } from "stateward";',
      'import { unions } from "@stateward/plugin-unions";',
      'import { records } from "@stateward/plugin-records";',
      ...lines,
    ].join("\n"),
  );
}

function findingsOf(stdout: string, ruleId: string): number {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !("rules" in parsed)) return -1;
  const { rules } = parsed;
  if (!Array.isArray(rules)) return -1;
  const row: unknown = rules.find(
    (one: unknown) =>
      typeof one === "object" && one !== null && Reflect.get(one, "ruleId") === ruleId,
  );
  const count: unknown =
    typeof row === "object" && row !== null ? Reflect.get(row, "findings") : undefined;
  return typeof count === "number" ? count : -1;
}

describe("stateward plan with overrides", { timeout: 20_000 }, () => {
  it("counts a rule only where it is on", async () => {
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], include: ["src/**"] };',
    ]);
    const everywhere = await run(["plan", "--format", "json"]);
    expect(findingsOf(everywhere.stdout, SWITCH_RULE)).toBe(2);

    writeConfig([
      "export default {",
      '  preset: "recommended",',
      "  plugins: [unions(), records()],",
      '  include: ["src/**"],',
      `  overrides: [{ files: ["src/status.ts"], rules: { "${SWITCH_RULE}": "off" } }],`,
      "};",
    ]);
    const skipped = await run(["plan", "--format", "json"]);
    expect(findingsOf(skipped.stdout, SWITCH_RULE)).toBe(0);
    // Another rule's findings in that file are still counted.
    expect(findingsOf(skipped.stdout, "records/lookup-misses-key")).toBe(1);
  });

  it("checks with the setting of each file", async () => {
    writeConfig([
      "export default {",
      '  preset: "recommended",',
      "  plugins: [unions(), records()],",
      '  include: ["src/**"],',
      `  overrides: [{ files: ["src/**"], rules: { "${SWITCH_RULE}": "off" } }],`,
      "};",
    ]);
    const { stdout } = await run(["check"]);
    expect(stdout).not.toContain(SWITCH_RULE);
    expect(stdout).toContain("records/lookup-misses-key");
  });
});

describe("the exclude hint", { timeout: 20_000 }, () => {
  beforeEach(() => {
    writeFileSync(path.join(work, "src", "status.test.ts"), "export const fine = 1;\n");
  });

  it("says once that exclude replaced the default list when tests are checked now", async () => {
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], exclude: ["src/generated/**"] };',
    ]);
    const { stdout } = await run(["check"]);
    expect(stdout.split("\n").filter((line) => line === HINT)).toHaveLength(1);
  });

  it("names what is checked now, grouped by the default pattern, up to three patterns", async () => {
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], exclude: ["src/generated/**"] };',
    ]);
    mkdirSync(path.join(work, "src", "__mocks__"));
    writeFileSync(path.join(work, "src", "__mocks__", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(work, "src", "__mocks__", "b.ts"), "export const b = 1;\n");
    expect((await run(["check"])).stdout).toContain(
      "your `exclude` replaces the default list, so 1 file matching `*.test.*`, 2 files in `__mocks__` are checked now; add `...defaults.exclude` to skip them\n",
    );
    writeFileSync(path.join(work, "src", "a.spec.ts"), "export const c = 1;\n");
    mkdirSync(path.join(work, "src", "__tests__"));
    writeFileSync(path.join(work, "src", "__tests__", "t.ts"), "export const d = 1;\n");
    mkdirSync(path.join(work, "src", "__fixtures__"));
    writeFileSync(path.join(work, "src", "__fixtures__", "f.ts"), "export const e = 1;\n");
    expect((await run(["check"])).stdout).toContain(
      "so 1 file matching `*.test.*`, 1 file matching `*.spec.*`, 1 file in `__tests__` and 2 more patterns are checked now;",
    );
  });

  it("is quiet when the default excludes are kept, or the test files are excluded another way", async () => {
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], exclude: [...defaults.exclude, "src/generated/**"] };',
    ]);
    expect((await run(["check"])).stdout).not.toContain(HINT);
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], exclude: ["src/status.test.ts"] };',
    ]);
    expect((await run(["check"])).stdout).not.toContain(HINT);
  });

  it("is not in the machine-readable output", async () => {
    writeConfig([
      'export default { preset: "recommended", plugins: [unions(), records()], exclude: ["src/generated/**"] };',
    ]);
    const { stdout } = await run(["check", "--format", "json"]);
    expect(stdout).not.toContain("replaces the default list");
  });
});
