import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

/**
 * A project with three `RequiredContext`s: `ThemeContext`, proven for two readers; `AuthContext`,
 * read by `<Profile>` with no Provider above it; and `LocaleContext`, read by nothing. Two
 * `Owned` values: `settings`, changed only by its own module; `session`, changed by `toolbar.ts`.
 * And `watchFeed`, stated `Release`, whose one caller hands what it returns on. `StoreContext`,
 * stated `SingleProvider` and `Stable`, provided once with a module constant; `ModeContext`, stated
 * `Stable`, provided with state in another file.
 */
const fixture = fileURLToPath(new URL("fixtures/guarantees", import.meta.url));
const scratchRoot = fileURLToPath(new URL("fixtures", import.meta.url));

const copies: string[] = [];

afterEach(() => {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
  cwd = fixture,
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

describe("stateward guarantees", { timeout: 30_000 }, () => {
  it("lists each guarantee with its declaration, its proof and its readers, and exits 1 when one is not proven", async () => {
    const { code, stdout, stderr } = await run(["guarantees"]);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "ThemeContext: RequiredContext<Theme>  src/contexts.ts:6",
        "  stated by the project's marker",
        "  proven for 2 readers",
        "  readers:",
        "    <Header>  src/Readers.tsx:4",
        "    <Footer>  src/Readers.tsx:8",
        "",
        "AuthContext: RequiredContext<User>  src/contexts.ts:7",
        "  stated by the project's marker",
        "  not proven: 1 error",
        "    src/main.tsx:4  `<App>` is rendered without `AuthContext.Provider`",
        "  readers:",
        "    <Profile>  src/Readers.tsx:12",
        "",
        "LocaleContext: RequiredContext<string>  src/contexts.ts:8",
        "  stated by the project's marker",
        "  unused: no reader, so nothing to prove; use it or drop the marker",
        "",
        "watchFeed: Release  src/feed.ts:3",
        "  stated by the project's marker",
        "  proven for 1 caller",
        "  callers:",
        "    feed.ts  src/feed.ts:9",
        "",
        "session: Owned<{ user: string | null }>  src/session.ts:3",
        "  stated by the project's marker",
        "  not proven: 1 error",
        "    src/toolbar.ts:9  `session` is changed outside its owner, `src/session.ts`",
        "  writers:",
        "    session.ts  src/session.ts:6",
        "    toolbar.ts  src/toolbar.ts:9",
        "",
        "settings: Owned<{ theme: string }>  src/settings.ts:3",
        "  stated by the project's marker",
        "  proven for 1 writer",
        "  writers:",
        "    settings.ts  src/settings.ts:6",
        "",
        "StoreContext: SingleProvider  src/stores.ts:6",
        "  stated by the project's marker",
        "  proven for 1 Provider",
        "  Providers:",
        "    <StoreContext.Provider>  src/Providers.tsx:7",
        "",
        "StoreContext: Stable  src/stores.ts:6",
        "  stated by the project's marker",
        "  proven for 1 Provider",
        "  Providers:",
        "    <StoreContext.Provider>  src/Providers.tsx:7",
        "",
        // Provided in another file than the context: the error is counted by the Provider it is in.
        "ModeContext: Stable  src/stores.ts:7",
        "  stated by the project's marker",
        "  not proven: 1 error",
        "    src/Providers.tsx:13  `ModeContext` is stated `Stable`, but its value changes when `mode` changes",
        "  Providers:",
        "    <ModeContext.Provider>  src/Providers.tsx:13",
        "",
        "9 guarantees: 5 proven, 3 not proven, 1 unused. `stateward check` shows each error with the path to it.",
        "",
      ].join("\n"),
    );
    expect(code).toBe(1);
  });

  it("prints the same as JSON", async () => {
    const { code, stdout } = await run(["guarantees", "--format", "json"]);
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toEqual({
      guarantees: [
        {
          guarantee: "required-context",
          source: { kind: "marker" },
          marker: "RequiredContext<Theme>",
          name: "ThemeContext",
          file: "src/contexts.ts",
          line: 6,
          rule: "react-context/provider-missing",
          status: "proven",
          errors: [],
          covers: "readers",
          covered: [
            { name: "<Header>", file: "src/Readers.tsx", line: 4 },
            { name: "<Footer>", file: "src/Readers.tsx", line: 8 },
          ],
        },
        {
          guarantee: "required-context",
          source: { kind: "marker" },
          marker: "RequiredContext<User>",
          name: "AuthContext",
          file: "src/contexts.ts",
          line: 7,
          rule: "react-context/provider-missing",
          status: "unproven",
          errors: [
            {
              file: "src/main.tsx",
              line: 4,
              message: "`<App>` is rendered without `AuthContext.Provider`",
            },
          ],
          covers: "readers",
          covered: [{ name: "<Profile>", file: "src/Readers.tsx", line: 12 }],
        },
        {
          guarantee: "required-context",
          source: { kind: "marker" },
          marker: "RequiredContext<string>",
          name: "LocaleContext",
          file: "src/contexts.ts",
          line: 8,
          rule: "react-context/provider-missing",
          status: "unused",
          errors: [],
          covers: "readers",
          covered: [],
        },
        {
          guarantee: "release",
          source: { kind: "marker" },
          marker: "Release",
          name: "watchFeed",
          file: "src/feed.ts",
          line: 3,
          rule: "ownership/resource-not-released",
          status: "proven",
          errors: [],
          covers: "callers",
          covered: [{ name: "feed.ts", file: "src/feed.ts", line: 9 }],
        },
        {
          guarantee: "owned",
          source: { kind: "marker" },
          marker: "Owned<{ user: string | null }>",
          name: "session",
          file: "src/session.ts",
          line: 3,
          rule: "ownership/state-written-outside-owner",
          status: "unproven",
          errors: [
            {
              file: "src/toolbar.ts",
              line: 9,
              message: "`session` is changed outside its owner, `src/session.ts`",
            },
          ],
          covers: "writers",
          covered: [
            { name: "session.ts", file: "src/session.ts", line: 6 },
            { name: "toolbar.ts", file: "src/toolbar.ts", line: 9 },
          ],
        },
        {
          guarantee: "owned",
          source: { kind: "marker" },
          marker: "Owned<{ theme: string }>",
          name: "settings",
          file: "src/settings.ts",
          line: 3,
          rule: "ownership/state-written-outside-owner",
          status: "proven",
          errors: [],
          covers: "writers",
          covered: [{ name: "settings.ts", file: "src/settings.ts", line: 6 }],
        },
        {
          guarantee: "single-provider",
          source: { kind: "marker" },
          marker: "SingleProvider",
          name: "StoreContext",
          file: "src/stores.ts",
          line: 6,
          rule: "react-context/provider-nested",
          status: "proven",
          errors: [],
          covers: "Providers",
          covered: [{ name: "<StoreContext.Provider>", file: "src/Providers.tsx", line: 7 }],
        },
        {
          guarantee: "stable",
          source: { kind: "marker" },
          marker: "Stable",
          name: "StoreContext",
          file: "src/stores.ts",
          line: 6,
          rule: "react-context/provider-value-changes-every-render",
          status: "proven",
          errors: [],
          covers: "Providers",
          covered: [{ name: "<StoreContext.Provider>", file: "src/Providers.tsx", line: 7 }],
        },
        {
          guarantee: "stable",
          source: { kind: "marker" },
          marker: "Stable",
          name: "ModeContext",
          file: "src/stores.ts",
          line: 7,
          rule: "react-context/provider-value-changes-every-render",
          status: "unproven",
          errors: [
            {
              file: "src/Providers.tsx",
              line: 13,
              message:
                "`ModeContext` is stated `Stable`, but its value changes when `mode` changes",
            },
          ],
          covers: "Providers",
          covered: [{ name: "<ModeContext.Provider>", file: "src/Providers.tsx", line: 13 }],
        },
      ],
      summary: { proven: 5, unproven: 3, unused: 1, off: 0 },
    });
  });

  it("lists a guarantee whose rule the rollout has not turned on yet as not checked, and exits 0", async () => {
    const dir = mkdtempSync(path.join(scratchRoot, ".guarantees-off-"));
    copies.push(dir);
    cpSync(fixture, dir, { recursive: true });
    const config = path.join(dir, "stateward.config.mjs");
    writeFileSync(
      config,
      readFileSync(config, "utf8").replace(
        'include: ["src/**"],',
        'include: ["src/**"],\n  rollout: true,',
      ),
    );
    const { code, stdout } = await run(["guarantees"], dir);
    expect(stdout).toContain(
      "ThemeContext: RequiredContext<Theme>  src/contexts.ts:6\n  stated by the project's marker\n  not checked: react-context/provider-missing is not on\n",
    );
    expect(stdout).toContain("9 guarantees: 0 proven, 9 not checked.");
    expect(code).toBe(0);
  });

  it("says when the project states no guarantee", async () => {
    const { code, stdout } = await run(["guarantees"], path.join(scratchRoot, "recommended"));
    expect(stdout).toBe(
      "No guarantee is stated in this project.\nA guarantee is a trait the code states, such as `RequiredContext` (the react-context pack), `Owned` or `Release` (the ownership pack): stateward then proves it everywhere. See docs/user/guarantees.md.\n",
    );
    expect(code).toBe(0);
  });
});
