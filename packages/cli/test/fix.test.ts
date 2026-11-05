import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding, Fix } from "@stateward/core/internal";
import { planFixes, textHash, unifiedDiff, writeFixes } from "../src/fix.js";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

/* The fix fixture: status.ts has a switch default and an else to prove (safe fixes), theme.ts has
   a switch default (safe), search.ts has a spinner left on (a warning with no safe fix). */
let work = "";

beforeEach(() => {
  work = mkdtempSync(path.join(fixtures, "tmp-"));
  cpSync(path.join(fixtures, "fix"), work, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
  extra: Partial<CliEnv> = {},
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd: work,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    ...extra,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

const read = (name: string): string => readFileSync(path.join(work, "src", name), "utf8");
const write = (name: string, text: string): void => {
  writeFileSync(path.join(work, "src", name), text);
};

const LEFT = "1 problem needs a decision (run without --fix to see it)";

describe("stateward check --fix", { timeout: 60_000 }, () => {
  it("applies the safe fixes only and says what is left", async () => {
    const search = read("search.ts");
    const fixed = await run(["check", "--fix"]);
    expect(fixed).toEqual({
      code: 0,
      stdout: `Fixed 3 problems in 2 files; ${LEFT}.\n`,
      stderr: "",
    });
    expect(read("status.ts")).toContain(
      '    default:\n      status satisfies never;\n      return "Other";',
    );
    expect(read("status.ts")).toContain('  } else {\n    status satisfies never;\n    return "?";');
    expect(read("theme.ts")).toContain("      mode satisfies never;");
    // The spinner fix changes behaviour (the flag is reset after a failure): never applied here.
    expect(read("search.ts")).toBe(search);
  });

  it("changes nothing the second time", async () => {
    await run(["check", "--fix"]);
    const after = { status: read("status.ts"), theme: read("theme.ts"), search: read("search.ts") };
    const again = await run(["check", "--fix"]);
    expect(again).toEqual({
      code: 0,
      stdout: `Nothing to fix without review; ${LEFT}.\n`,
      stderr: "",
    });
    expect({
      status: read("status.ts"),
      theme: read("theme.ts"),
      search: read("search.ts"),
    }).toEqual(after);
  });

  it("leaves a clean check after the fixes (the fixed code passes)", async () => {
    await run(["check", "--fix"]);
    const checked = await run(["check", "--rule", "unions/default-hides-cases"]);
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain("No problems");
  });

  it("prints a diff and writes nothing with --dry-run", async () => {
    const before = { status: read("status.ts"), theme: read("theme.ts") };
    const dry = await run(["check", "--fix", "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("--- a/src/theme.ts\n+++ b/src/theme.ts\n@@ -7,6 +7,7 @@");
    expect(dry.stdout).toContain('+      mode satisfies never;\n       return "Other";');
    expect(dry.stdout).toContain("--- a/src/status.ts\n+++ b/src/status.ts\n");
    // A path shown to the user uses `/` on every system (Windows included): no `\` in a header.
    expect(dry.stdout).not.toMatch(/^(---|\+\+\+) .*\\/m);
    expect(dry.stdout).toContain(
      `Would fix 3 problems in 2 files; ${LEFT}. Nothing was written.\n`,
    );
    expect({ status: read("status.ts"), theme: read("theme.ts") }).toEqual(before);
  });

  it("fixes only the rule or group asked for", async () => {
    const only = await run(["check", "--fix", "--rule", "unions/default-hides-cases"]);
    expect(only.stdout).toBe("Fixed 2 problems in 2 files; nothing is left.\n");
    expect(read("status.ts")).not.toContain('status satisfies never;\n    return "?"');
    expect(read("theme.ts")).toContain("mode satisfies never;");
    const group = await run(["check", "--fix", "--group", "unions/cases"]);
    expect(group.code).toBe(0);
    expect(group.stdout).toContain("Fixed 1 problem in 1 file; nothing is left.");
    expect(read("status.ts")).toContain("  } else {\n    status satisfies never;");
  });

  it("does not fix what the baseline accepted, and fixes what is new", async () => {
    await run(["baseline"]);
    const baselined = { status: read("status.ts"), theme: read("theme.ts") };
    write(
      "extra.ts",
      'export type Size = "s" | "l";\n\nexport function size(value: Size): number {\n  switch (value) {\n    case "s":\n      return 1;\n    case "l":\n      return 2;\n    default:\n      return 0;\n  }\n}\n',
    );
    const fixed = await run(["check", "--fix"]);
    expect(fixed.stdout).toBe("Fixed 1 problem in 1 file; nothing is left.\n");
    expect(read("extra.ts")).toContain("value satisfies never;");
    expect({ status: read("status.ts"), theme: read("theme.ts") }).toEqual(baselined);
  });

  it("fixes the ignore comments that are not needed", async () => {
    write(
      "theme.ts",
      `// stateward-ignore unions/tag-does-not-discriminate: old\n${read("theme.ts")}`,
    );
    const all = await run(["check", "--fix"]);
    expect(all.code).toBe(0);
    expect(read("theme.ts")).not.toContain("stateward-ignore");
    expect(read("theme.ts")).toContain("mode satisfies never;");
  });

  it("counts removing an unneeded ignore as a fix with --dry-run too, and shows it in the diff", async () => {
    write(
      "theme.ts",
      `// stateward-ignore unions/tag-does-not-discriminate: old\n${read("theme.ts")}`,
    );
    const dry = await run(["check", "--fix", "--dry-run"]);
    expect(dry.stdout).toContain(
      "--- a/src/theme.ts\n+++ b/src/theme.ts\n@@ -1,4 +1,3 @@\n-// stateward-ignore unions/tag-does-not-discriminate: old\n",
    );
    expect(dry.stdout).toContain(
      `Would fix 4 problems in 2 files; ${LEFT}. Nothing was written.\n`,
    );
    const fixed = await run(["check", "--fix"]);
    expect(fixed.stdout).toBe(`Fixed 4 problems in 2 files; ${LEFT}.\n`);
  });

  it("counts only problems as needing a decision, not places not checked", async () => {
    // A file that does not parse is a place not checked (`stateward/syntax`), not a problem.
    write("broken.ts", "export const = ;\n");
    const fixed = await run(["check", "--fix"]);
    expect(fixed.stdout).toBe(`Fixed 3 problems in 2 files; ${LEFT}.\n`);
    const again = await run(["check", "--fix"]);
    expect(again.stdout).toBe(`Nothing to fix without review; ${LEFT}.\n`);
  });

  it("exits with what is left: an error without a safe fix still fails", async () => {
    write(
      "words.ts",
      'import type { Status } from "./status.js";\nconst words: Record<string, string> = { idle: "idle" };\nexport function word(status: Status): string | undefined {\n  return words[status];\n}\n',
    );
    const fixed = await run(["check", "--fix"]);
    expect(fixed.code).toBe(1);
    expect(fixed.stdout).toBe(
      "Fixed 3 problems in 2 files; 2 problems need a decision (run without --fix to see them).\n",
    );
  });

  it("only fixes the changed files with --changed", async () => {
    const git = (args: string[]): void => {
      execFileSync("git", args, { cwd: work, stdio: "ignore" });
    };
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"]);
    write("theme.ts", `${read("theme.ts")}\n`);
    const fixed = await run(["check", "--fix", "--changed"]);
    expect(fixed.stdout).toContain("Fixed 1 problem in 1 file;");
    expect(read("theme.ts")).toContain("mode satisfies never;");
    expect(read("status.ts")).not.toContain("satisfies never");
  });

  it("leaves a file alone that changed while it was checking, and fixes the others", async () => {
    const saved = `// saved while checking\n${read("theme.ts")}`;
    const fixed = await run(["check", "--fix"], {
      beforeFixWrite: () => {
        write("theme.ts", saved);
      },
    });
    expect(fixed.stdout).toBe(
      "skipped `src/theme.ts`: it changed while stateward was checking; run again\n" +
        "Fixed 2 problems in 1 file; 2 problems need a decision (run without --fix to see them).\n",
    );
    expect(read("theme.ts")).toBe(saved);
    expect(read("status.ts")).toContain("status satisfies never;");
  });

  it("refuses a bad command line", async () => {
    const dry = await run(["check", "--dry-run"]);
    expect(dry.code).toBe(2);
    expect(dry.stderr).toContain("--dry-run goes with --fix");
    const json = await run(["check", "--fix", "--format", "json"]);
    expect(json.stderr).toContain("--fix prints plain text");
    const other = await run(["baseline", "--fix"]);
    expect(other.stderr).toContain("--fix only applies to check");
  });
});

/**
 * A config with one more rule: it reports `odd` with a safe fix that does not compile, and `even`
 * with a safe fix whose first form does not compile and whose second does.
 */
const CHECKED_CONFIG = [
  'import { asyncFlow } from "@stateward/plugin-async";',
  'import { records } from "@stateward/plugin-records";',
  'import { unions } from "@stateward/plugin-unions";',
  "const copies = {",
  '  kind: "file",',
  '  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },',
  "  check(ctx) {",
  "    for (const statement of ctx.sourceFile.statements) {",
  "      const name = statement.declarationList?.declarations[0]?.name.text;",
  '      if (name !== "odd" && name !== "even") continue;',
  "      const at = (title, newText) => ({ title, safe: true, edits: [{ location: { file: ctx.file, start: statement.end, end: statement.end }, newText }] });",
  '      const wrong = at("Copy as text", `\\nexport const ${name}Copy: string = ${name};`);',
  '      const right = at("Copy as number", `\\nexport const ${name}Copy: number = ${name};`);',
  '      const fix = name === "odd" ? wrong : { ...wrong, alternatives: [right] };',
  '      ctx.report({ node: statement, message: `copy ${name}`, hint: "copy it", fixes: [fix] });',
  "    }",
  "  },",
  "};",
  "export default {",
  '  preset: "recommended",',
  '  plugins: [unions(), records(), asyncFlow(), { name: "checked", description: "d", rules: { copies } }],',
  '  include: ["src/**"],',
  '  rules: { "checked/copies": "warning" },',
  "};",
  "",
].join("\n");

describe("stateward check: fixes are tried first", { timeout: 60_000 }, () => {
  beforeEach(() => {
    writeFileSync(path.join(work, "stateward.config.mjs"), CHECKED_CONFIG);
    write("numbers.ts", "export const odd = 1;\nexport const even = 2;\n");
  });

  it("applies with --fix only the fixes that compile, in the first form that does", async () => {
    await run(["check", "--fix"]);
    expect(read("numbers.ts")).toBe(
      "export const odd = 1;\nexport const even = 2;\nexport const evenCopy: number = even;\n",
    );
    // The unions fixes compile and are applied as before.
    expect(read("theme.ts")).toContain("mode satisfies never;");
  });

  it('lists in JSON the fixes as given, not tried ("verified": null), unless --verify-fixes', async () => {
    const json = await run(["check", "--format", "json"]);
    expect(json.stdout).toContain('"verified": null');
    expect(json.stdout).not.toContain('"verified": true');
    expect(json.stdout).not.toContain('"verified": false');
    expect(JSON.parse(json.stdout)).toHaveProperty("findings");
  });

  it("prints the same JSON text on a cold and a warm run", async () => {
    const cache = mkdtempSync(path.join(os.tmpdir(), "stateward-warm-"));
    try {
      for (const flags of [[], ["--verify-fixes"]]) {
        rmSync(cache, { recursive: true, force: true });
        const argv = ["check", "--format", "json", ...flags];
        const cold = await run(argv, { cacheDir: () => cache });
        const warm = await run(argv, { cacheDir: () => cache });
        expect(cold.stdout).toContain('"fixes"');
        // The elapsed time is the one thing that may differ.
        const untimed = (text: string): string => text.replace(/"durationMs": \d+/, "");
        expect(untimed(warm.stdout)).toBe(untimed(cold.stdout));
      }
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("lists in JSON the fixes that compile, the ones that do not and why, and the ignore edit", async () => {
    const json = await run(["check", "--format", "json", "--verify-fixes"]);
    const parsed: unknown = JSON.parse(json.stdout);
    const findings: readonly unknown[] =
      typeof parsed === "object" &&
      parsed !== null &&
      "findings" in parsed &&
      Array.isArray(parsed.findings)
        ? parsed.findings
        : [];
    const named = (message: string): unknown =>
      findings.find(
        (finding: unknown) =>
          typeof finding === "object" &&
          finding !== null &&
          "message" in finding &&
          finding.message === message,
      );
    const reason = "Type 'number' is not assignable to type 'string'.";
    expect(named("copy odd")).toMatchObject({
      hint: `copy it\nno automatic fix: ${reason}`,
      fixes: [],
      rejected: [{ title: "Copy as text", reason }],
      ignore: {
        title: "Ignore this case here",
        edits: [{ newText: "// stateward-ignore checked/copies: \n" }],
      },
    });
    expect(named("copy even")).toMatchObject({
      hint: "copy it",
      fixes: [{ title: "Copy as number", safe: true, verified: true }],
      rejected: [{ title: "Copy as text", reason }],
    });
    // An earlier release listed `"fixes": []` here: the unions fix is listed, tried.
    const theme = findings.find(
      (finding: unknown) =>
        typeof finding === "object" &&
        finding !== null &&
        "location" in finding &&
        JSON.stringify(finding.location).includes("theme.ts"),
    );
    expect(theme).toMatchObject({
      ruleId: "unions/default-hides-cases",
      fixes: [{ title: "Add `mode satisfies never;` to the default", verified: true }],
      rejected: [],
    });
  });
});

function problem(file: string, fixes: readonly Fix[], start = 0, ruleId = "x/r"): Finding {
  return {
    kind: "problem",
    ruleId,
    severity: "error",
    message: "m",
    hint: "h",
    location: { file, start, end: start + 1 },
    related: [],
    fixes,
  };
}
const edit = (file: string, start: number, end: number, newText: string): Fix["edits"][number] => ({
  location: { file, start, end },
  newText,
});

describe("planFixes", () => {
  let root = "";
  let outside = "";
  beforeEach(() => {
    const base = mkdtempSync(path.join(os.tmpdir(), "stateward-fix-"));
    root = path.join(base, "project");
    outside = path.join(base, "other");
    mkdirSync(root);
    mkdirSync(outside);
  });
  afterEach(() => {
    rmSync(path.dirname(root), { recursive: true, force: true });
  });
  const reader = (file: string): string | undefined => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  };

  it("takes the earlier of two fixes that overlap, and both when they do not", () => {
    const file = path.join(root, "a.ts");
    writeFileSync(file, "0123456789");
    const plan = planFixes(
      [
        problem(file, [{ title: "a", safe: true, edits: [edit(file, 2, 5, "A")] }], 2),
        problem(file, [{ title: "b", safe: true, edits: [edit(file, 4, 6, "B")] }], 4),
        problem(file, [{ title: "c", safe: true, edits: [edit(file, 8, 8, "C")] }], 8),
        problem(file, [{ title: "d", safe: true, edits: [edit(file, 8, 8, "D")] }], 8, "x/z"),
        problem(file, [{ title: "e", safe: true, edits: [edit(file, 5, 5, "E")] }], 5),
      ],
      { root, readText: reader },
    );
    expect(plan.files.map((f) => f.after)).toEqual(["01AE567C89"]);
    expect(plan.applied.length).toBe(3);
  });

  it("applies the fixes as the set verified together: a broken one left out, an import removed", () => {
    const file = path.join(root, "a.ts");
    writeFileSync(file, "0123456789");
    const plan = planFixes(
      [
        problem(file, [{ title: "a", safe: true, edits: [edit(file, 2, 3, "A")] }], 2),
        problem(file, [{ title: "b", safe: true, edits: [edit(file, 6, 7, "B")] }], 6),
      ],
      {
        root,
        readText: reader,
        verify: (forms) => {
          expect(forms.map((form) => form.title)).toEqual(["a", "b"]);
          return { kept: [true, false], edits: [edit(file, 0, 1, ""), edit(file, 2, 3, "A")] };
        },
      },
    );
    expect(plan.files.map((f) => f.after)).toEqual(["1A3456789"]);
    expect(plan.applied.map((entry) => entry.finding.location.start)).toEqual([2]);
  });

  it("makes an edit two fixes share once (the same import)", () => {
    const file = path.join(root, "a.ts");
    writeFileSync(file, "abc");
    const plan = planFixes(
      [
        problem(
          file,
          [{ title: "a", safe: true, edits: [edit(file, 0, 0, "I;"), edit(file, 1, 2, "X")] }],
          1,
        ),
        problem(
          file,
          [{ title: "b", safe: true, edits: [edit(file, 0, 0, "I;"), edit(file, 2, 3, "Y")] }],
          2,
        ),
      ],
      { root, readText: reader },
    );
    expect(plan.files.map((f) => f.after)).toEqual(["I;aXY"]);
    expect(plan.applied.length).toBe(2);
  });

  it("never applies a fix that is not marked safe", () => {
    const file = path.join(root, "a.ts");
    writeFileSync(file, "abc");
    const plan = planFixes([problem(file, [{ title: "a", edits: [edit(file, 0, 1, "X")] }])], {
      root,
      readText: reader,
    });
    expect(plan).toEqual({ files: [], applied: [] });
  });

  it("leaves a file outside the project alone, with the whole fix", () => {
    const inside = path.join(root, "a.ts");
    const elsewhere = path.join(outside, "b.ts");
    writeFileSync(inside, "abc");
    writeFileSync(elsewhere, "xyz");
    const plan = planFixes(
      [
        problem(inside, [
          {
            title: "both",
            safe: true,
            edits: [edit(inside, 0, 1, "A"), edit(elsewhere, 0, 1, "X")],
          },
        ]),
        problem(elsewhere, [{ title: "out", safe: true, edits: [edit(elsewhere, 0, 1, "X")] }]),
      ],
      { root, readText: reader },
    );
    expect(plan).toEqual({ files: [], applied: [] });
    expect(readFileSync(elsewhere, "utf8")).toBe("xyz");
  });

  // A file symlink needs administrator rights on Windows (a junction links folders only), so the
  // case cannot be set up there without them: a limit of the platform, not of the check.
  it.skipIf(process.platform === "win32")("does not follow a link out of the project", () => {
    const elsewhere = path.join(outside, "b.ts");
    writeFileSync(elsewhere, "xyz");
    const link = path.join(root, "link.ts");
    symlinkSync(elsewhere, link);
    const plan = planFixes(
      [problem(link, [{ title: "l", safe: true, edits: [edit(link, 0, 1, "X")] }])],
      {
        root,
        readText: reader,
      },
    );
    expect(plan.files).toEqual([]);
  });

  it("keeps a byte order mark and skips edits past the end of the file", () => {
    const file = path.join(root, "a.ts");
    writeFileSync(file, "﻿abc");
    const plan = planFixes(
      [
        problem(file, [{ title: "a", safe: true, edits: [edit(file, 1, 2, "B")] }], 1),
        problem(file, [{ title: "z", safe: true, edits: [edit(file, 40, 41, "Z")] }], 40),
      ],
      { root, readText: reader },
    );
    expect(plan.files.map((f) => f.after)).toEqual(["﻿aBc"]);
  });

  it("writes a planned file only while its text is the one planned on, keeping its byte order mark", () => {
    const kept = path.join(root, "a.ts");
    const moved = path.join(root, "b.ts");
    writeFileSync(kept, "\uFEFFabc");
    writeFileSync(moved, "abc");
    const plan = planFixes(
      [
        problem(kept, [{ title: "a", safe: true, edits: [edit(kept, 0, 1, "X")] }]),
        problem(moved, [{ title: "b", safe: true, edits: [edit(moved, 0, 1, "X")] }]),
      ],
      { root, readText: () => "abc" },
    );
    expect(plan.files.map((f) => f.planned)).toEqual([textHash("abc"), textHash("abc")]);
    writeFileSync(moved, "zabc");
    const written = new Map<string, string>();
    const skipped = writeFixes(plan, reader, (file, text) => written.set(file, text));
    expect(skipped).toEqual([moved]);
    expect([...written]).toEqual([[kept, "\uFEFFXbc"]]);
  });

  it("is limited to the chosen files", () => {
    const a = path.join(root, "a.ts");
    const b = path.join(root, "b.ts");
    writeFileSync(a, "abc");
    writeFileSync(b, "abc");
    const plan = planFixes(
      [
        problem(a, [{ title: "a", safe: true, edits: [edit(a, 0, 1, "X")] }]),
        problem(b, [{ title: "b", safe: true, edits: [edit(b, 0, 1, "X")] }]),
      ],
      { root, readText: reader, only: new Set([path.join(statRoot(root), "a.ts")]) },
    );
    expect(plan.files.map((f) => path.basename(f.file))).toEqual(["a.ts"]);
  });
});

function statRoot(root: string): string {
  return realpathSync(root);
}

describe("unifiedDiff", () => {
  it("shows hunks with three lines of context, and nothing when equal", () => {
    expect(unifiedDiff("a.ts", "x\n", [])).toBe("");
    expect(unifiedDiff("a.ts", "x\n", [{ start: 0, end: 1, newText: "x" }])).toBe("");
    const before = Array.from({ length: 12 }, (_, i) => `l${String(i + 1)}`).join("\n") + "\n";
    const afterL2 = before.indexOf("l3\n");
    const l11 = before.indexOf("l11\n");
    const edits = [
      { start: l11, end: l11 + 4, newText: "" },
      { start: afterL2, end: afterL2, newText: "new\n" },
    ];
    expect(unifiedDiff("a.ts", before, edits)).toBe(
      [
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1,5 +1,6 @@",
        " l1",
        " l2",
        "+new",
        " l3",
        " l4",
        " l5",
        "@@ -8,5 +9,4 @@",
        " l8",
        " l9",
        " l10",
        "-l11",
        " l12",
        "",
      ].join("\n"),
    );
  });

  it("joins edits within 6 lines into one hunk, and shows a changed line as - then +", () => {
    const before = Array.from({ length: 8 }, (_, i) => `l${String(i + 1)}`).join("\n");
    const l2 = before.indexOf("l2");
    const l7 = before.indexOf("l7");
    const edits = [
      { start: l2, end: l2 + 2, newText: "two" },
      { start: l7, end: l7 + 2, newText: "seven" },
    ];
    expect(unifiedDiff("a.ts", before, edits)).toBe(
      [
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1,8 +1,8 @@",
        " l1",
        "-l2",
        "+two",
        " l3",
        " l4",
        " l5",
        " l6",
        "-l7",
        "+seven",
        " l8",
        "",
      ].join("\n"),
    );
  });

  // Review 5: a full line-by-line comparison of a 40,000-line file took minutes or ran out of
  // memory; the diff now looks only at the lines the edits touch.
  it("diffs a 40,000-line file with an edit at each end in under a second", () => {
    const lines = Array.from({ length: 40_000 }, (_, i) => `const v${String(i)} = ${String(i)};`);
    const before = `${lines.join("\n")}\n`;
    const last = before.lastIndexOf("const v39999");
    const started = performance.now();
    const diff = unifiedDiff("a.ts", before, [
      { start: 0, end: 0, newText: "import x from 'y';\n" },
      { start: last, end: before.length - 1, newText: "const last = 1;" },
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(diff.split("\n")).toEqual([
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,4 @@",
      "+import x from 'y';",
      " const v0 = 0;",
      " const v1 = 1;",
      " const v2 = 2;",
      "@@ -39997,4 +39998,4 @@",
      " const v39996 = 39996;",
      " const v39997 = 39997;",
      " const v39998 = 39998;",
      "-const v39999 = 39999;",
      "+const last = 1;",
      "",
    ]);
  });
});
