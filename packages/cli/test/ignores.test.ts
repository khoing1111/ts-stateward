import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

/* The adopt fixture has 4 findings, all in src/status.ts: see adopt.test.ts. */
const ORDER = [
  "records/duplicate-key",
  "unions/if-chain-misses-case",
  "records/lookup-misses-key",
  "unions/default-hides-cases",
  "unions/tag-does-not-discriminate",
] as const;

let work = "";

beforeEach(() => {
  work = mkdtempSync(path.join(fixtures, "tmp-"));
  cpSync(path.join(fixtures, "adopt"), work, { recursive: true });
  writeFileSync(
    path.join(work, "stateward.rollout.json"),
    JSON.stringify({ version: 1, enabled: ORDER }),
  );
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

const statusPath = (): string => path.join(work, "src", "status.ts");
const edit = (change: (text: string) => string): void => {
  writeFileSync(statusPath(), change(readFileSync(statusPath(), "utf8")));
};
const ignoreLookup = (reason: string): void => {
  edit((text) =>
    text.replace(
      "  return words[status];",
      `  // stateward-ignore records/lookup-misses-key${reason}\n  return words[status];`,
    ),
  );
};

describe("stateward check and ignore comments", { timeout: 30_000 }, () => {
  it("leaves a covered finding out and counts it in the summary", async () => {
    ignoreLookup(": the server sends only these keys");
    const checked = await run(["check"]);
    expect(checked.code).toBe(1);
    expect(checked.stdout).not.toContain("records/lookup-misses-key");
    expect(checked.stdout).toContain("2 errors, 1 warning in 1 file");
    expect(checked.stdout).toContain(", 1 ignored in the code.");
  });

  it("warns about a comment with no reason, and about one that matches nothing", async () => {
    ignoreLookup("");
    edit((text) => `// stateward-ignore unions/tag-does-not-discriminate: old\n${text}`);
    const checked = await run(["check"]);
    expect(checked.stdout).toContain(
      "warning[stateward/ignore]: ignore comment does not say why the case is fine",
    );
    expect(checked.stdout).toContain(
      "warning[stateward/ignore]: ignore comment is not needed: `unions/tag-does-not-discriminate` finds nothing in the code it covers",
    );
    expect(checked.stdout).toContain("1 ignored in the code");
  });

  it("says a rule id that does not exist is not a stateward rule", async () => {
    edit((text) => `// stateward-ignore guards/dead-variants: old\n${text}`);
    const checked = await run(["check"]);
    expect(checked.stdout).toContain(
      "error[stateward/ignore]: `guards/dead-variants` is not a stateward rule",
    );
  });

  it("--no-ignores shows the covered findings and the summary does not count them", async () => {
    ignoreLookup(": why");
    const all = await run(["check", "--no-ignores"]);
    expect(all.stdout).toContain("error[records/lookup-misses-key]");
    expect(all.stdout).toContain("3 errors, 1 warning in 1 file");
    expect(all.stdout).not.toContain("ignored in the code");
  });

  it("marks covered findings in the JSON with their reason", async () => {
    ignoreLookup(": the server sends only these keys");
    const json = await run(["check", "--format", "json"]);
    const parsed: unknown = JSON.parse(json.stdout);
    if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) {
      throw new Error("expected findings");
    }
    const { findings } = parsed;
    if (!Array.isArray(findings)) throw new Error("expected a list");
    const ignored = findings.filter((finding: unknown) => {
      return typeof finding === "object" && finding !== null && "ignored" in finding;
    });
    expect(ignored).toMatchObject([
      {
        ruleId: "records/lookup-misses-key",
        ignored: { reason: "the server sends only these keys" },
      },
    ]);
    expect(findings).toHaveLength(4);
  });

  it("is the same on a second run that reads the cache, and after editing only the comment", async () => {
    const cacheDir = path.join(work, "cache");
    const cached = async (): Promise<string> => {
      let stdout = "";
      const env: CliEnv = {
        cwd: work,
        stdout: (text) => (stdout += text),
        stderr: () => undefined,
        color: false,
        cacheDir: () => cacheDir,
      };
      await main(["check"], env);
      return stdout.replace(/\(\d+\.\d s\)/, "(t)");
    };
    ignoreLookup(": why");
    const cold = await cached();
    expect(await cached()).toBe(cold);
    edit((text) =>
      text.replace(
        "stateward-ignore records/lookup-misses-key: why",
        "stateward-ignore records/lookup-misses-key",
      ),
    );
    const edited = await cached();
    expect(edited).toContain("ignore comment does not say why the case is fine");
    expect(edited).not.toBe(cold);
  });

  it("keeps the baseline and the ignore side by side", async () => {
    await run(["baseline"]);
    ignoreLookup(": why");
    const checked = await run(["check"]);
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain("No problems in 1 file (");
    expect(checked.stdout).toContain("3 baselined");
    expect(checked.stdout).toContain(", 1 ignored in the code.");
  });

  it("explains stateward/ignore and parses --no-ignores", async () => {
    const explained = await run(["explain", "stateward/ignore"]);
    expect(explained.code).toBe(0);
    for (const section of [
      "Why",
      "When to use it",
      "What it catches",
      "What it does not catch",
      "Turn it on or off",
    ]) {
      expect(explained.stdout).toContain(`## ${section}`);
    }
    expect(parseArgs(["check", "--no-ignores"])).toMatchObject({
      ok: true,
      value: { kind: "check", noIgnores: true },
    });
    expect(parseArgs(["plan", "--no-ignores"])).toEqual({
      ok: false,
      errors: ["--no-ignores only applies to check"],
    });
  });
});
