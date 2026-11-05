import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
  cwd = dir,
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

// These run real checks of example projects (1 to 2 s each, more on a busy machine).
describe("stateward check", { timeout: 20_000 }, () => {
  it("reports the hiding default, the loose table and the placeholder default in examples/basic and exits 1", async () => {
    const { code, stdout, stderr } = await run(["check"], example);
    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(stdout).toMatch(
      new RegExp(
        [
          "^warning\\[team/max-union-members\\]: `AppEvent` has 13 members; above 12, switches over it get hard to keep complete",
          " --> src/events.ts:2:13",
          "  \\|",
          "2 \\| export type AppEvent =",
          "  \\| {13}\\^{8}",
          "  = fix: split it into nested unions by kind",
          "        type AppEvent = UserEvent \\| SystemEvent;",
          "        type UserEvent = Click \\| Key \\| …;",
          "        type SystemEvent = Load \\| Timeout \\| …;",
          "  = docs: stateward explain team/max-union-members",
          "",
          'error\\[unions/default-hides-cases\\]: this `default` hides 1 case of `status`: "failed"',
          " --> src/status.ts:9:5",
          "  \\|",
          "9 \\|     default:",
          "  \\| {5}\\^{7}",
          "  = fix: list the case, then put `status satisfies never;` in the `default`, or if the `default` is right for it, say so:",
          '        default: status satisfies "failed";',
          "  = docs: stateward explain unions/default-hides-cases",
          "",
          "error\\[records/table-type-too-loose\\]: `labels` is typed `Record<string, string>`: a fixed table or an open dictionary\\?",
          "  --> src/status.ts:14:7",
          "   \\|",
          '14 \\| const labels: Record<string, string> = \\{ idle: "Idle", uploading: "Uploading" \\};',
          "   \\| {7}\\^{6}",
          "   = fix: keys from outside: `Partial<Record<string, string>>`; every key known: look keys up as `keyof typeof labels`, then use `satisfies`",
          '   = note: keys: "idle", "uploading"',
          "   = docs: stateward explain records/table-type-too-loose",
          "",
          "error\\[react-context/fake-default-value\\]: `ThemeContext` gets a placeholder value \\(`\\{\\}`\\) when its Provider is missing",
          " --> src/theme.tsx:5:29",
          "  \\|",
          "5 \\| export const ThemeContext = createContext\\(\\{\\}\\);",
          "  \\| {29}\\^{17}",
          "  = fix: create it with `undefined` and read it in a hook that throws when it is missing:",
          "        const ThemeContext = createContext<Theme \\| undefined>\\(undefined\\);",
          '        // in useTheme\\(\\): if \\(value === undefined\\) throw new Error\\("ThemeContext needs a Provider"\\);',
          "  = docs: stateward explain react-context/fake-default-value",
          "",
          "3 errors, 1 warning in 5 files \\(\\d+\\.\\d s\\)\\. Run `stateward explain <rule>` for details\\.\\n$",
        ].join("\\n"),
      ),
    );
  });

  it("shows the placeholder default as info, and exits 0, under the default preset", async () => {
    const { code, stdout } = await run(["check"], path.join(fixtures, "recommended"));
    expect(stdout).toContain("info[react-context/fake-default-value]");
    expect(stdout).toMatch(/1 info in 1 file/);
    expect(code).toBe(0);
  });

  it("keeps the findings of examples/basic errors: its config says preset strict, and its own team rule warns", async () => {
    const { stdout } = await run(["check", "--format", "json"], example);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      findings: [
        { ruleId: "team/max-union-members", severity: "warning" },
        { ruleId: "unions/default-hides-cases", severity: "error" },
        { ruleId: "records/table-type-too-loose", severity: "error" },
        { ruleId: "react-context/fake-default-value", severity: "error" },
      ],
    });
  });

  it("resolves --cwd against the working directory and can print JSON", async () => {
    const { code, stdout } = await run(
      ["check", "--format", "json", "--verify-fixes", "--cwd", "examples/basic"],
      fileURLToPath(new URL("../../..", import.meta.url)),
    );
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      findings: [
        {
          kind: "problem",
          ruleId: "team/max-union-members",
          message:
            "`AppEvent` has 13 members; above 12, switches over it get hard to keep complete",
        },
        {
          kind: "problem",
          ruleId: "unions/default-hides-cases",
          hint: 'list the case, then put `status satisfies never;` in the `default`, or if the `default` is right for it, say so:\n    default: status satisfies "failed";',
        },
        {
          kind: "problem",
          ruleId: "records/table-type-too-loose",
          hint: "keys from outside: `Partial<Record<string, string>>`; every key known: look keys up as `keyof typeof labels`, then use `satisfies`\nno automatic fix: Type 'string | undefined' is not assignable to type 'string'.",
        },
        {
          kind: "problem",
          ruleId: "react-context/fake-default-value",
          hint: [
            "create it with `undefined` and read it in a hook that throws when it is missing:",
            "    const ThemeContext = createContext<Theme | undefined>(undefined);",
            '    // in useTheme(): if (value === undefined) throw new Error("ThemeContext needs a Provider");',
          ].join("\n"),
        },
      ],
      hidden: [],
    });
  });

  it("exits 0 when nothing is an error", async () => {
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      [
        'const rule = { kind: "file", meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" }, check() {} };',
        'export default { preset: "recommended", plugins: [{ name: "t", description: "t", rules: { rule } }] };',
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(dir, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    const { code, stdout } = await run(["check"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^No problems in 1 file \(\d+\.\d s\)\.\n$/);
  });

  it("reports a file with a syntax error as an unknown, never as No problems", async () => {
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      "export default { preset: 'recommended', plugins: [] };\n",
    );
    writeFileSync(path.join(dir, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(path.join(dir, "a.ts"), "export const a = ;\n");
    const { stdout } = await run(["check"]);
    expect(stdout).not.toContain("No problems");
    expect(stdout).toContain(
      "`a.ts` has a syntax error, so findings in it may be missing or wrong",
    );
    expect(stdout).toContain("1 place not checked");
    const explained = await run(["explain", "stateward/syntax"]);
    expect(explained.stdout).toContain("stateward/syntax");
  });

  it("says first when more than 20% of the files import packages that do not resolve", async () => {
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      "export default { preset: 'recommended', plugins: [] };\n",
    );
    writeFileSync(path.join(dir, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
    writeFileSync(
      path.join(dir, "a.ts"),
      'import { x } from "not-installed";\nexport const a = x;\n',
    );
    writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
    writeFileSync(path.join(dir, "c.ts"), "export const c = 1;\n");
    const { stdout } = await run(["check"]);
    expect(
      stdout.startsWith(
        "1 of 3 files import packages that do not resolve: install the project's packages first (`npm install`, `yarn`, `pnpm install`); findings in those files may be missing.\n",
      ),
    ).toBe(true);
    expect(stdout).toContain("`a.ts` imports `not-installed`, which does not resolve");
    expect(stdout).toContain("1 place not checked");
    writeFileSync(path.join(dir, "d.ts"), "export const d = 1;\n");
    writeFileSync(path.join(dir, "e.ts"), "export const e = 1;\n");
    writeFileSync(path.join(dir, "f.ts"), "export const f = 1;\n");
    const few = await run(["check"]);
    expect(few.stdout).not.toContain("of 6 files import packages");
    const explained = await run(["explain", "stateward/imports"]);
    expect(explained.stdout).toContain("It cannot be turned off");
  });

  it("follows the references of a Vite-style solution tsconfig and exits 1 with the finding", async () => {
    const { code, stdout, stderr } = await run(["check"], path.join(fixtures, "vite-solution"));
    expect(stderr).toBe("");
    expect(stdout).toContain(
      "error[react-context/fake-default-value]: `ThemeContext` gets a placeholder value (`null!`)",
    );
    expect(stdout).toContain(" --> src/theme.ts:3:29");
    expect(stdout).toMatch(/1 error in 1 file/);
    expect(code).toBe(1);
  });

  it("says no rule is on, and exits 0, when the config names a pack but turns nothing on", async () => {
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] } }),
    );
    writeFileSync(path.join(dir, "a.ts"), "export const a: Record<string, string> = {};\n");
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      [
        "const rule = {",
        '  kind: "file",',
        '  meta: { description: "d", defaultSeverity: "error", tier: "core", group: "g", explain: "e" },',
        "  check() {},",
        "};",
        'export default { plugins: [{ name: "t", description: "t", rules: { rule } }] };',
        "",
      ].join("\n"),
    );
    const { code, stdout } = await run(["check"]);
    expect(stdout).toBe(
      'No rules are on: add `preset: "recommended"`, a group or a rule to stateward.config (see docs/user/config.md)\n',
    );
    expect(code).toBe(0);
  });

  it("exits 2 with the reason and the fix when the tsconfig gives no files to check", async () => {
    const { code, stdout, stderr } = await run(["check"], path.join(fixtures, "nothing"));
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      [
        "stateward: `tsconfig.json` gives stateward no files to check",
        '  = fix: point "tsconfig" in stateward.config.ts at a tsconfig that lists your source files, or widen "include"',
        "",
      ].join("\n"),
    );
  });

  it("exits 2 and prints the failure when a rule throws", async () => {
    const { code, stdout } = await run(["check"], path.join(fixtures, "throwing"));
    expect(code).toBe(2);
    expect(stdout).toContain("failure[boom/throws]: rule boom/throws failed: kaput");
    expect(stdout).toContain("  = fix: report this to the rule's authors");
    expect(stdout).toContain("  = docs: stateward explain boom/throws");
    expect(stdout).toMatch(/1 rule failure in 1 file/);
    const json = await run(["check", "--format", "json"], path.join(fixtures, "throwing"));
    expect(json.code).toBe(2);
    expect(json.stdout).toContain('"kind": "failure"');
  });

  it("exits 2 with the reason when there is no config", async () => {
    const { code, stderr } = await run(["check"]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward: no stateward.config.{ts,mts,js,mjs} found");
  });

  it("exits 2 when the tsconfig is missing", async () => {
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      "export default { preset: 'recommended', plugins: [] };\n",
    );
    const { code, stderr } = await run(["check"]);
    expect(code).toBe(2);
    expect(stderr).toContain("tsconfig not found");
    expect(stderr).toContain(
      '\n  = fix: point "tsconfig" in stateward.config.ts at your project\'s tsconfig.json\n',
    );
  });

  it("exits 2 with a fix line when the tsconfig is invalid", async () => {
    writeFileSync(
      path.join(dir, "stateward.config.mjs"),
      "export default { preset: 'recommended', plugins: [] };\n",
    );
    writeFileSync(path.join(dir, "tsconfig.json"), "{ not json");
    const { code, stderr } = await run(["check"]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward: invalid tsconfig");
    expect(stderr.trimEnd().split("\n").at(-1)).toBe(
      "  = fix: fix the tsconfig errors above, then run stateward check again",
    );
  });

  it("exits 2 with the usage on a bad command line", async () => {
    const { code, stderr } = await run(["check", "--format", "xml"]);
    expect(code).toBe(2);
    expect(stderr).toContain('--format must be "pretty", "json" or "github"');
    expect(stderr).toContain("usage:");
  });
});

describe("stateward coverage", { timeout: 20_000 }, () => {
  it("lists what is outside the standard per plugin, and counts the problems", async () => {
    const { code, stdout, stderr } = await run(["coverage"], example);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        "react-context: A component that needs a context is always rendered under its Provider.",
        "1 place it cannot check yet",
        "  src/theme.tsx:5:29  `ThemeContext` gets a placeholder value (`{}`) when its Provider is missing",
        "      fix: create it with `undefined` and read it in a hook that throws when it is missing:",
        "    const ThemeContext = createContext<Theme | undefined>(undefined);",
        '    // in useTheme(): if (value === undefined) throw new Error("ThemeContext needs a Provider");',
        "0 problems",
        "",
        "unions: Every case of a union is handled, and its tag tells the cases apart.",
        "0 places it cannot check yet",
        "1 problem (`stateward check` lists them)",
        "",
        "records: Lookup tables and records keyed by a union have every key, once, under a type that names them.",
        "0 places it cannot check yet",
        "1 problem (`stateward check` lists them)",
        "",
        "team: This team's own rules.",
        "0 places it cannot check yet",
        "1 problem (`stateward check` lists them)",
        "",
      ].join("\n"),
    );
  });

  it("prints the same as data with --format json", async () => {
    const { code, stdout } = await run(["coverage", "--format", "json"], example);
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      plugins: [
        {
          plugin: "react-context",
          outside: [
            {
              ruleId: "react-context/fake-default-value",
              kind: "problem",
              file: "src/theme.tsx",
              line: 5,
              column: 29,
            },
          ],
          problems: 0,
        },
        { plugin: "unions", outside: [], problems: 1 },
        { plugin: "records", outside: [], problems: 1 },
        { plugin: "team", outside: [], problems: 1 },
      ],
      failures: [],
    });
  });

  it("exits 0 with findings under recommended, where coverage is info", async () => {
    const { code, stdout } = await run(["coverage"], path.join(fixtures, "recommended"));
    expect(code).toBe(0);
    expect(stdout).toContain("1 place it cannot check yet");
  });

  it("exits 2 and names the rule when a rule failed", async () => {
    const { code, stdout } = await run(["coverage"], path.join(fixtures, "throwing"));
    expect(code).toBe(2);
    expect(stdout).toContain("1 rule failure\n  boom/throws: rule boom/throws failed: kaput");
  });

  it("exits 2 with the reason when there is no config", async () => {
    const { code, stderr } = await run(["coverage"]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward: no stateward.config.{ts,mts,js,mjs} found");
  });
});

describe("stateward init", () => {
  const installLine = (output: string): string | undefined =>
    output.split("\n").find((line) => /^ {2}(npm|pnpm|yarn|bun) /.test(line));

  it("writes unions, records, async and errors for a project without react, with the recommended preset", async () => {
    writeFileSync(path.join(dir, "package.json"), '{ "dependencies": { "left-pad": "1" } }');
    const { code, stdout } = await run(["init"]);
    expect(code).toBe(0);
    expect(readFileSync(path.join(dir, "stateward.config.ts"), "utf8")).toBe(
      [
        'import { defineConfig } from "stateward";',
        'import { unions } from "@stateward/plugin-unions";',
        'import { records } from "@stateward/plugin-records";',
        'import { asyncFlow } from "@stateward/plugin-async";',
        'import { errors } from "@stateward/plugin-errors";',
        "",
        "export default defineConfig({",
        "  plugins: [unions(), records(), asyncFlow(), errors()],",
        "  // turns on the recommended rules of these packs; remove it to choose rules one by one",
        '  preset: "recommended",',
        "});",
        "",
      ].join("\n"),
    );
    expect(stdout).toContain("Created stateward.config.ts");
    expect(stdout).toContain("packs   unions, records, async, errors (detected from package.json)");
    expect(installLine(stdout)).toBe(
      "  npm install --save-dev stateward @stateward/plugin-unions @stateward/plugin-records @stateward/plugin-async @stateward/plugin-errors",
    );
    // No pack needs a helper package in the app.
    expect(stdout).not.toContain("helpers the fixes use");
  });

  it("adds react-context and react when react is a dependency or a devDependency", async () => {
    for (const field of ["dependencies", "devDependencies"]) {
      const project = mkdtempSync(path.join(dir, "react-"));
      writeFileSync(path.join(project, "package.json"), `{ "${field}": { "react": "^19" } }`);
      await run(["init"], project);
      const config = readFileSync(path.join(project, "stateward.config.ts"), "utf8");
      expect(config).toContain(
        "plugins: [unions(), records(), asyncFlow(), reactContext(), errors(), react()],",
      );
      expect(config).toContain('import { reactContext } from "@stateward/plugin-react-context";');
      expect(config).toContain('import { react } from "@stateward/plugin-react";');
    }
  });

  it("adds async to every project, imported as asyncFlow", async () => {
    writeFileSync(path.join(dir, "package.json"), '{ "dependencies": { "react": "^19" } }');
    await run(["init"]);
    const config = readFileSync(path.join(dir, "stateward.config.ts"), "utf8");
    expect(config).toContain('import { asyncFlow } from "@stateward/plugin-async";');
    expect(config).not.toContain("@stateward/values");
  });

  it("writes unions, records, async and errors when there is no package.json", async () => {
    const { stdout } = await run(["init"]);
    expect(stdout).toContain("packs   unions, records, async, errors (detected from package.json)");
    expect(readFileSync(path.join(dir, "stateward.config.ts"), "utf8")).not.toContain(
      "reactContext",
    );
  });

  it("lets --packs override detection and --preset strict set the preset", async () => {
    writeFileSync(path.join(dir, "package.json"), '{ "dependencies": { "react": "^19" } }');
    const { code, stdout } = await run(["init", "--packs", "unions", "--preset", "strict"]);
    expect(code).toBe(0);
    const config = readFileSync(path.join(dir, "stateward.config.ts"), "utf8");
    expect(config).toContain("plugins: [unions()],");
    expect(config).toContain('preset: "strict",');
    expect(stdout).toContain("packs   unions (from --packs)");
    expect(stdout).toContain("preset  strict");
  });

  it.each([
    ["unions", 'import { unions } from "@stateward/plugin-unions";', "unions()"],
    ["records", 'import { records } from "@stateward/plugin-records";', "records()"],
    ["async", 'import { asyncFlow } from "@stateward/plugin-async";', "asyncFlow()"],
    ["ownership", 'import { ownership } from "@stateward/plugin-ownership";', "ownership()"],
    ["reducers", 'import { reducers } from "@stateward/plugin-reducers";', "reducers()"],
    [
      "react-context",
      'import { reactContext } from "@stateward/plugin-react-context";',
      "reactContext()",
    ],
  ])(
    "--packs %s writes that pack and installs its own package, and no helper",
    async (pack, line, call) => {
      const { code, stdout } = await run(["init", "--packs", pack]);
      expect(code).toBe(0);
      const config = readFileSync(path.join(dir, "stateward.config.ts"), "utf8");
      expect(config).toContain(line);
      expect(config).toContain(`plugins: [${call}],`);
      expect(stdout).toContain(`packs   ${pack} (from --packs)`);
      expect(installLine(stdout)).toContain(`stateward @stateward/plugin-${pack}`);
      expect(stdout).not.toContain("helpers the fixes use");
    },
  );

  it("lists the packs' packages in the order given", async () => {
    const { stdout } = await run(["init", "--packs", "async,records,unions"]);
    expect(installLine(stdout)).toBe(
      "  npm install --save-dev stateward @stateward/plugin-async @stateward/plugin-records @stateward/plugin-unions",
    );
  });

  it("can force react-context in a project that does not list react", async () => {
    await run(["init", "--packs", "react-context,unions"]);
    expect(readFileSync(path.join(dir, "stateward.config.ts"), "utf8")).toContain(
      "plugins: [reactContext(), unions()],",
    );
  });

  it.each([
    ["package-lock.json", "npm install --save-dev"],
    ["pnpm-lock.yaml", "pnpm add -D"],
    ["yarn.lock", "yarn add -D"],
    ["bun.lock", "bun add -d"],
    ["bun.lockb", "bun add -d"],
  ])("prints the install command for %s and does not run it", async (lockfile, command) => {
    writeFileSync(path.join(dir, lockfile), "");
    writeFileSync(path.join(dir, "package.json"), '{ "devDependencies": { "react": "^19" } }');
    const { code, stdout } = await run(["init"]);
    expect(code).toBe(0);
    expect(installLine(stdout)).toBe(
      `  ${command} stateward @stateward/plugin-unions @stateward/plugin-records @stateward/plugin-async @stateward/plugin-react-context @stateward/plugin-errors @stateward/plugin-react`,
    );
    expect(existsSync(path.join(dir, "node_modules"))).toBe(false);
  });

  it("exits 2 and writes nothing when package.json cannot be read as JSON", async () => {
    writeFileSync(path.join(dir, "package.json"), "{ nope");
    const { code, stderr } = await run(["init"]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward: package.json is not valid JSON");
    expect(existsSync(path.join(dir, "stateward.config.ts"))).toBe(false);
  });

  it("never overwrites an existing config", async () => {
    const file = path.join(dir, "stateward.config.mjs");
    writeFileSync(file, "export default { preset: 'recommended', plugins: [] };\n");
    const { code, stdout } = await run(["init"]);
    expect(code).toBe(0);
    expect(stdout).toBe("stateward.config.mjs already exists; nothing written.\n");
    expect(readFileSync(file, "utf8")).toBe(
      "export default { preset: 'recommended', plugins: [] };\n",
    );
    expect(existsSync(path.join(dir, "stateward.config.ts"))).toBe(false);
  });
});

describe("stateward explain", { timeout: 20_000 }, () => {
  it("prints the explanation of a known rule", async () => {
    const { code, stdout } = await run(["explain", "react-context/fake-default-value"], example);
    expect(code).toBe(0);
    expect(stdout).toContain("## Bad");
    expect(stdout).toContain("## Good");
  });

  it("exits 2 and lists the known rules for an unknown id", async () => {
    const { code, stderr } = await run(["explain", "react-context/nope"], example);
    expect(code).toBe(2);
    expect(stderr).toBe(
      'stateward: unknown rule "react-context/nope"; known rules: react-context/fake-default-value, react-context/provider-missing, unions/default-hides-cases, unions/if-chain-misses-case, unions/tag-does-not-discriminate, records/lookup-misses-key, records/table-type-too-loose, records/duplicate-key, records/keyed-maps-out-of-sync, team/max-union-members\n',
    );
  });
});
