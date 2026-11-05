import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import {
  COMMAND_HELP,
  commandHelp,
  isHelpTopic,
  overviewHelp,
  usageAfterError,
} from "../src/help.js";
import { main, unknownRuleMessage } from "../src/main.js";
import type { ExitCode } from "../src/main.js";

async function run(
  argv: readonly string[],
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    cwd: process.cwd(),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    version: "1.2.3",
  });
  return { code, stdout, stderr };
}

describe("help", () => {
  it("lists every command with a sentence, and how to get more", async () => {
    const { code, stdout } = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toBe(overviewHelp());
    for (const name of Object.keys(COMMAND_HELP)) expect(stdout).toContain(`  ${name} `);
    expect(stdout).toContain("stateward <command> --help");
  });

  it.each(Object.keys(COMMAND_HELP))(
    "`%s --help` shows the usage, every option and one example",
    async (name) => {
      for (const argv of [
        [name, "--help"],
        ["help", name],
      ]) {
        const { code, stdout } = await run(argv);
        expect(code).toBe(0);
        expect(stdout.startsWith(`usage: stateward ${name}`)).toBe(true);
        expect(stdout).toContain("\nexample:\n  stateward ");
        if (isHelpTopic(name)) expect(stdout).toBe(commandHelp(name));
      }
    },
  );

  it("documents only options the command accepts", () => {
    for (const [name, help] of Object.entries(COMMAND_HELP)) {
      for (const [flag] of help.options) {
        const [option, value] = flag.split(" ");
        // `init --changed` is the form of `--ci github` for pull requests: it needs that option.
        const companion =
          name === "init" && option === "--changed"
            ? ["--ci", "github"]
            : name === "check" && option === "--dry-run"
              ? ["--fix"]
              : name === "check" && option === "--verify-fixes"
                ? ["--format", "json"]
                : name === "cache"
                  ? ["stats"]
                  : [];
        const argv = [
          name,
          ...(name === "explain" ? ["guards/x"] : []),
          ...companion,
          option ?? "",
        ];
        if (value !== undefined) {
          const sample =
            option === "--format"
              ? "json"
              : option === "--preset"
                ? "strict"
                : option === "--max" || option === "--max-warnings"
                  ? "3"
                  : option === "--max-memory"
                    ? "6144"
                    : option === "--ci"
                      ? "github"
                      : option === "--hook"
                        ? "pre-push"
                        : option === "--packs"
                          ? "unions"
                          : "x";
          argv.push(sample);
        }
        expect(parseArgs(argv), `${name} ${flag}`).toMatchObject({ ok: true });
      }
    }
  });

  it("prints the version, or says it is unknown", async () => {
    expect(await run(["--version"])).toEqual({ code: 0, stdout: "1.2.3\n", stderr: "" });
    expect((await run(["-v"])).stdout).toBe("1.2.3\n");
  });

  it("after a bad option on a known command shows only that command's usage", async () => {
    const { code, stderr } = await run(["check", "--format", "xml"]);
    expect(code).toBe(2);
    expect(stderr).toBe(
      `stateward: --format must be "pretty", "json" or "github", not "xml"\n${usageAfterError("check")}\n`,
    );
    expect(stderr).toContain("Run `stateward check --help` for the options.");
    expect(stderr.split("\n").length).toBeLessThan(6);
  });

  it("after an unknown command points at --help in one line", async () => {
    const { code, stderr } = await run(["foo"]);
    expect(code).toBe(2);
    expect(stderr).toBe(
      'stateward: unknown command "foo"\nRun `stateward --help` for the commands.\n',
    );
  });

  it("with no command at all shows every usage line", async () => {
    const { code, stderr } = await run([]);
    expect(code).toBe(2);
    expect(stderr).toContain("stateward: give a command, e.g. stateward check");
    expect(stderr).toContain("  stateward explain <rule>");
  });
});

describe("unknownRuleMessage", () => {
  it("suggests the ids that end in what was typed", () => {
    expect(
      unknownRuleMessage("table-type-too-loose", ["guards/a", "records/table-type-too-loose"]),
    ).toBe(
      'unknown rule "table-type-too-loose"; did you mean records/table-type-too-loose? known rules: guards/a, records/table-type-too-loose',
    );
  });

  it("says nothing extra when nothing is close", () => {
    expect(unknownRuleMessage("nope", ["guards/a"])).toBe(
      'unknown rule "nope"; known rules: guards/a',
    );
  });
});
