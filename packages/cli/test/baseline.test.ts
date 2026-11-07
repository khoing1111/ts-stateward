import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const baselinePath = (): string => path.join(work, "stateward.baseline.json");
const statusPath = (): string => path.join(work, "src", "status.ts");
const edit = (change: (text: string) => string): void => {
  writeFileSync(statusPath(), change(readFileSync(statusPath(), "utf8")));
};
/** One item per accepted finding: an entry with `"count": 2` gives two. */
const entries = (): { ruleId: string; file: string }[] => {
  const parsed: unknown = JSON.parse(readFileSync(baselinePath(), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) return [];
  const { findings } = parsed;
  if (!Array.isArray(findings)) return [];
  return findings.flatMap((entry: unknown) =>
    typeof entry === "object" &&
    entry !== null &&
    "ruleId" in entry &&
    "file" in entry &&
    typeof entry.ruleId === "string" &&
    typeof entry.file === "string"
      ? Array.from(
          { length: "count" in entry && typeof entry.count === "number" ? entry.count : 1 },
          () => ({ ruleId: String(entry.ruleId), file: String(entry.file) }),
        )
      : [],
  );
};

describe("stateward baseline", { timeout: 30_000 }, () => {
  it("accepts today's findings and says so; check then lists none and exits 0", async () => {
    expect((await run(["check"])).code).toBe(1);
    const made = await run(["baseline"]);
    expect(made).toEqual({
      code: 0,
      stdout: "baselined 4 findings in 1 file; only new ones will fail from now on\n",
      stderr: "",
    });
    expect(entries().map((entry) => entry.file)).toEqual(Array(4).fill("src/status.ts"));
    const checked = await run(["check"]);
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain("rollout: 5 rules on");
    expect(checked.stdout).toContain("No problems in 1 file (");
    expect(checked.stdout).toContain(
      "(4 baselined: `stateward baseline --prune` after fixing them)",
    );
    expect(checked.stdout).not.toContain("guards/");
  });

  it("keeps an entry when the code moves, and reports a finding whose own line was edited", async () => {
    await run(["baseline"]);
    edit((text) => `// a comment\n// another\n${text}`);
    expect((await run(["check"])).code).toBe(0);
    edit((text) =>
      text.replace("return words[status];", "const found = words[status]; return found;"),
    );
    const changed = await run(["check"]);
    expect(changed.code).toBe(1);
    expect(changed.stdout).toContain("error[records/lookup-misses-key]");
    expect(changed.stdout).toContain("1 error in 1 file");
    expect(changed.stdout).toContain("(3 baselined:");
    expect(changed.stdout).toContain(
      "1 baselined finding is fixed; run stateward baseline --prune",
    );
  });

  it("--no-baseline shows everything", async () => {
    await run(["baseline"]);
    const all = await run(["check", "--no-baseline"]);
    expect(all.code).toBe(1);
    expect(all.stdout).toContain("records/lookup-misses-key");
    expect(all.stdout).not.toContain("baselined");
  });

  it("marks baselined findings in the JSON instead of dropping them", async () => {
    await run(["baseline"]);
    edit((text) =>
      text.replace("return words[status];", "const found = words[status]; return found;"),
    );
    const { stdout } = await run(["check", "--format", "json"]);
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) {
      throw new Error("no findings");
    }
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    expect(findings).toHaveLength(4);
    expect(findings.filter((finding: object) => "baselined" in finding)).toHaveLength(3);
    expect(
      findings.every((finding: object) => !("baselined" in finding) || finding.baselined === true),
    ).toBe(true);
    expect(parsed).toMatchObject({ baseline: { baselined: 3, fixed: 1 } });
  });

  it("--prune removes the fixed entries and says how many", async () => {
    await run(["baseline"]);
    edit((text) => text.replace("return words[status];", 'return "x";'));
    const pruned = await run(["baseline", "--prune"]);
    expect(pruned.code).toBe(0);
    expect(pruned.stdout).toBe(
      "pruned 1 fixed finding from stateward.baseline.json; 3 still baselined\n",
    );
    expect(entries()).toHaveLength(3);
    const again = await run(["baseline", "--prune"]);
    expect(again.stdout).toBe("nothing to prune: all 3 baselined findings are still found\n");
  });

  it("--prune drops entries of a rule its pack no longer has, and keeps those of a pack not loaded", async () => {
    await run(["baseline"]);
    const parsed: unknown = JSON.parse(readFileSync(baselinePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) {
      throw new Error("the baseline has no findings");
    }
    const findings: unknown[] = Array.isArray(parsed.findings) ? parsed.findings : [];
    const [first] = findings;
    if (typeof first !== "object" || first === null) throw new Error("the baseline is empty");
    writeFileSync(
      baselinePath(),
      JSON.stringify({
        ...parsed,
        findings: [
          ...findings,
          { ...first, ruleId: "records/keyed-maps-out-of-sync", fingerprint: "a1" },
          { ...first, ruleId: "elsewhere/kept-rule", fingerprint: "b2" },
        ],
      }),
    );
    const pruned = await run(["baseline", "--prune"]);
    expect(pruned.code).toBe(0);
    expect(pruned.stdout).toBe(
      "pruned 0 fixed findings, and 1 finding of rules that no longer exist (records/keyed-maps-out-of-sync) from stateward.baseline.json; 5 still baselined\n",
    );
    const ids = entries().map((entry) => entry.ruleId);
    expect(ids).not.toContain("records/keyed-maps-out-of-sync");
    expect(ids).toContain("elsewhere/kept-rule");
  });

  it("--prune without a baseline says what to run", async () => {
    const { code, stderr } = await run(["baseline", "--prune"]);
    expect(code).toBe(2);
    expect(stderr).toContain("there is no baseline to prune; run `stateward baseline`");
  });

  it("writes nothing when there is nothing to accept", async () => {
    writeFileSync(path.join(work, "src", "status.ts"), "export const a = 1;\n");
    const { code, stdout } = await run(["baseline"]);
    expect(code).toBe(0);
    expect(stdout).toBe("nothing to baseline: the check found no problems\n");
    expect(existsSync(baselinePath())).toBe(false);
  });

  it("stops with the file name and a fix when the file is broken", async () => {
    writeFileSync(baselinePath(), "{ nope");
    for (const argv of [["check"], ["baseline"], ["baseline", "--prune"], ["next"]]) {
      const { code, stderr } = await run(argv);
      expect(code).toBe(2);
      expect(stderr).toContain("stateward.baseline.json is not valid JSON");
      expect(stderr).toContain("delete it and run `stateward baseline`");
    }
  });

  it("only looks at the rules that ran: --rule does not call other entries fixed", async () => {
    await run(["baseline"]);
    const { code, stdout } = await run(["check", "--rule", ORDER[2]]);
    expect(code).toBe(0);
    expect(stdout).toContain("(1 baselined:");
    expect(stdout).not.toContain("is fixed");
  });
});

describe("stateward next --baseline", { timeout: 30_000 }, () => {
  it("turns the next rule on and baselines its findings, so the one after is not blocked", async () => {
    rmSync(path.join(work, "stateward.rollout.json"));
    const first = await run(["next", "--baseline"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`on: ${ORDER[1]} (1 finding, 0 fixable)`);
    expect(first.stdout).toContain(
      `baselined 1 finding of ${ORDER[1]} in 1 file; only new ones will fail from now on`,
    );
    expect(entries().map((entry) => entry.ruleId)).toEqual([ORDER[1]]);
    expect(JSON.parse(readFileSync(path.join(work, "stateward.rollout.json"), "utf8"))).toEqual({
      version: 1,
      enabled: [ORDER[0], "records/table-type-too-loose", ORDER[4], ORDER[1]],
    });
    const plain = await run(["next"]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain(`on: ${ORDER[2]}`);
    expect(entries()).toHaveLength(1);
  });

  it("without the flag the rule still blocks", async () => {
    rmSync(path.join(work, "stateward.rollout.json"));
    await run(["next"]);
    expect((await run(["next"])).code).toBe(1);
    expect(existsSync(baselinePath())).toBe(false);
  });
});

describe("a baseline in the first file format", { timeout: 30_000 }, () => {
  /** Today's findings as the first format wrote them: fingerprints of old headlines. */
  async function writeFirstFormat(): Promise<void> {
    await run(["baseline"]);
    // One entry per finding: a first-format file could list them so as well as with "count".
    const findings = entries().map((entry, i) => ({
      ruleId: entry.ruleId,
      file: entry.file,
      fingerprint: `00000000000000${String(i).padStart(2, "0")}`,
      message: "a headline an older stateward said",
    }));
    expect(findings).toHaveLength(4);
    writeFileSync(baselinePath(), JSON.stringify({ version: 1, findings }));
  }

  it("still accepts every finding, and says once how to refresh it", async () => {
    await writeFirstFormat();
    const checked = await run(["check"]);
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain("(4 baselined:");
    expect(checked.stdout.split("written by an older stateward")).toHaveLength(2);
    expect(checked.stdout).toContain(
      "your baseline was written by an older stateward; run `stateward baseline` to refresh it (nothing is lost)",
    );
    const json = await run(["check", "--format", "json"]);
    expect(json.stderr).toContain("written by an older stateward");
  });

  it("--prune keeps the entries that still match", async () => {
    await writeFirstFormat();
    const pruned = await run(["baseline", "--prune"]);
    expect(pruned.stdout).toBe("nothing to prune: all 4 baselined findings are still found\n");
    expect((await run(["check"])).code).toBe(0);
  });

  it("`stateward baseline` writes it again in the current format", async () => {
    await writeFirstFormat();
    await run(["baseline"]);
    const written: unknown = JSON.parse(readFileSync(baselinePath(), "utf8"));
    expect(written).toMatchObject({ version: 2 });
    expect(readFileSync(baselinePath(), "utf8")).not.toContain('"legacy"');
    const checked = await run(["check"]);
    expect(checked.code).toBe(0);
    expect(checked.stdout).not.toContain("older stateward");
  });
});
