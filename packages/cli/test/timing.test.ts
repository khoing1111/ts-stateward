import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv } from "../src/main.js";

const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));

async function run(argv: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd: example,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

/** The rule ids of the timing report's table, in its order, and their times. */
function ruleRows(text: string): { id: string; ms: number }[] {
  return [...text.matchAll(/^ *([\d,]+) ms +[\d.]+% +[\d,]+ ms +[\d.]+ MB {2}(\S+)/gm)].map(
    (match) => ({ id: match[2] ?? "", ms: Number((match[1] ?? "").replaceAll(",", "")) }),
  );
}

describe("stateward check --timing", { timeout: 30_000 }, () => {
  it("prints, after the summary, the phases and every rule that ran, slowest first", async () => {
    const plain = await run(["check"]);
    const timed = await run(["check", "--timing"]);
    expect(timed.code).toBe(plain.code);
    // The report is the plain one, then the timing.
    const at = timed.stdout.indexOf("\nTiming (the check took ");
    expect(at).toBeGreaterThan(0);
    const summary = plain.stdout.replace(/\(\d+(?:\.\d+)? m?s/, "");
    expect(timed.stdout.slice(0, at).replace(/\(\d+(?:\.\d+)? m?s/, "")).toBe(summary);
    const timing = timed.stdout.slice(at);
    for (const phase of [
      "building programs",
      "rules",
      "in type questions",
      "fingerprints",
      "other",
    ]) {
      expect(timing).toMatch(new RegExp(`^ +${phase} +[\\d,]+ ms +[\\d.]+%`, "m"));
    }
    // Each column says what it measures: no "heap" that is really allocation.
    expect(timing).toContain("share: of the whole check's time.");
    expect(timing).toContain("allocated: memory the rule allocated");
    expect(timing).not.toMatch(/\bheap\b/);
    const rows = ruleRows(timing);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.ms)).toEqual([...rows.map((row) => row.ms)].sort((a, b) => b - a));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("keeps stdout for the findings with --format json: the timing goes to stderr", async () => {
    const timed = await run(["check", "--timing", "--format", "json"]);
    expect(() => {
      JSON.parse(timed.stdout);
    }).not.toThrow();
    expect(timed.stderr).toMatch(
      /^\nTiming \(the check took [\d,]+ ms; peak memory [\d.]+ MB\):\n/,
    );
    // Fixes are tried only on request: then their time is said too.
    expect(timed.stderr).not.toMatch(/trying fixes/);
    const verified = await run(["check", "--timing", "--format", "json", "--verify-fixes"]);
    expect(verified.stderr).toMatch(/^ +trying fixes +[\d,]+ ms {2}after the check$/m);
  });
});
