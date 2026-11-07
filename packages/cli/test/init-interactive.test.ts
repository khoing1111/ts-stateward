import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACK_CATALOG } from "../src/index.js";
import { PACK_FACTORIES } from "./packs.js";
import { NEXT_FIRST_RULE, main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-init-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A fake terminal that types for the developer: each time the program shows a prompt (a line
 * that ends in `: ` or `] `, with no newline), the next scripted answer is typed and echoed, so
 * `transcript` reads like a session. When the answers run out the input ends, like Ctrl-D.
 */
function scriptedTerminal(answers: readonly string[]) {
  const input = new PassThrough();
  const queue = [...answers];
  let transcript = "";
  let prompts = 0;
  const output = new Writable({
    write(chunk, _encoding, done) {
      const text = String(chunk);
      transcript += text;
      if (/^[^\n]*(: |\] )$/.test(text)) {
        prompts += 1;
        const answer = queue.shift();
        if (answer === undefined) {
          input.end();
        } else {
          transcript += `${answer}\n`;
          input.write(`${answer}\n`);
        }
      }
      done();
    },
  });
  return { input, output, transcript: () => transcript, prompts: () => prompts };
}

type Result = {
  code: ExitCode;
  stdout: string;
  stderr: string;
  transcript: string;
  prompts: number;
};

async function init(
  answers: readonly string[] | undefined,
  args: readonly string[] = [],
  cwd = dir,
): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const terminal = answers === undefined ? undefined : scriptedTerminal(answers);
  const env: CliEnv = {
    cwd,
    stdout: (text) => {
      stdout += text;
      terminal?.output.write(text.replace(/^/, "\n").replace(/\n+$/, "\n\n"));
    },
    stderr: (text) => (stderr += text),
    color: false,
    terminal:
      terminal === undefined ? undefined : { input: terminal.input, output: terminal.output },
  };
  const code = await main(["init", ...args], env);
  return {
    code,
    stdout,
    stderr,
    transcript: terminal?.transcript() ?? "",
    prompts: terminal?.prompts() ?? 0,
  };
}

const config = (cwd = dir): string => readFileSync(path.join(cwd, "stateward.config.ts"), "utf8");

function writeManifest(deps: Record<string, string>): void {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
}

function writeSource(): void {
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "app.ts"), "export const a = 1;\n");
}

describe("stateward init, on a terminal", () => {
  it("Enter accepts every default: detected packs, recommended, one at a time for existing code", async () => {
    writeManifest({ react: "^19", "react-router-dom": "^7" });
    writeSource();
    const result = await init(["", "", "", ""]);
    expect(result.code).toBe(0);
    expect(result.prompts).toBe(4);
    expect(config()).toBe(
      [
        'import { defineConfig } from "stateward";',
        'import { unions } from "@stateward/plugin-unions";',
        'import { records } from "@stateward/plugin-records";',
        'import { asyncFlow } from "@stateward/plugin-async";',
        'import { reactContext } from "@stateward/plugin-react-context";',
        'import { errors } from "@stateward/plugin-errors";',
        'import { react } from "@stateward/plugin-react";',
        "",
        "export default defineConfig({",
        "  plugins: [unions(), records(), asyncFlow(), reactContext(), errors(), react()],",
        "  // turns on the recommended rules of these packs; remove it to choose rules one by one",
        '  preset: "recommended",',
        '  addons: ["react-context/react-router"],',
        "  rollout: true,",
        "});",
        "",
      ].join("\n"),
    );
    expect(result.stdout).toContain(
      "packs   unions, records, async, react-context, errors, react (your choice)",
    );
    expect(result.stdout).toContain("preset  recommended");
    expect(result.stdout).toContain("add-ons react-context/react-router");
    expect(result.stdout).toContain("rollout on: rules are turned on one at a time");
    expect(result.stdout).toContain(NEXT_FIRST_RULE);
    expect(result.stdout).not.toContain("Then run: stateward check");
  });

  it("ticks the detected packs and shows the one-line descriptions", async () => {
    writeManifest({ react: "^19" });
    const { transcript } = await init([""]);
    expect(transcript).toContain("  1. [x] unions         ");
    expect(transcript).toContain("  2. [x] records        ");
    expect(transcript).toContain("  3. [x] async          ");
    expect(transcript).toContain("  4. [x] react-context  ");
  });

  it("shows each pack's own description, not a copy of it", async () => {
    const { transcript } = await init([""]);
    const width = Math.max(...PACK_CATALOG.map((pack) => pack.name.length));
    for (const pack of PACK_CATALOG) {
      const plugin = PACK_FACTORIES[pack.importName]?.();
      expect(plugin?.name).toBe(pack.name);
      expect(transcript).toContain(`${pack.name.padEnd(width)}  ${plugin?.description ?? ""}`);
    }
  });

  it("toggles the numbers typed, separated by spaces or commas", async () => {
    writeManifest({ react: "^19" });
    // 2 off (it was on), 4 and 8 off (react was detected).
    await init(["2,4 8", ""]);
    expect(config()).toContain("plugins: [unions(), asyncFlow(), errors()],");
  });

  it("asks again, saying why, for numbers it does not know and for an empty choice", async () => {
    const result = await init(["9", "1 2 3 5", "abc", "", ""]);
    expect(result.transcript).toContain('"9" is not a pack number; type numbers from 1 to 8');
    expect(result.transcript).toContain("Pick at least one pack.");
    expect(config()).toContain("plugins: [unions(), records(), asyncFlow(), errors()],");
    expect(result.prompts).toBe(5);
  });

  it.each([
    ["2", "strict"],
    ["strict", "strict"],
    ["1", "recommended"],
    ["recommended", "recommended"],
    ["", "recommended"],
  ])("preset answer %j gives %s", async (answer, preset) => {
    await init(["", answer]);
    expect(config()).toContain(`preset: "${preset}",`);
  });

  it("asks the preset again for an answer that is not one", async () => {
    const result = await init(["", "loose", "2"]);
    expect(result.transcript).toContain('"loose" is not a preset');
    expect(config()).toContain('preset: "strict",');
  });

  it("asks about one rule at a time only when the project has code, and Enter means yes", async () => {
    const without = await init(["", ""]);
    expect(without.prompts).toBe(2);
    expect(without.transcript).not.toContain("one at a time");
    expect(config()).not.toContain("rollout");
    expect(without.stdout).toContain("Then run: stateward check");
  });

  it.each([["y"], ["YES"], [""]])("rollout answer %j turns rollout on", async (answer) => {
    writeSource();
    const result = await init(["", "", answer]);
    expect(result.transcript).toContain(
      "Turn rules on one at a time? (recommended for existing code) [Y/n] " + answer,
    );
    expect(config()).toContain("rollout: true,");
  });

  it("rollout answer n leaves it off, and the next step is check", async () => {
    writeSource();
    const result = await init(["", "", "n"]);
    expect(config()).not.toContain("rollout");
    expect(result.stdout).not.toContain("rollout on");
    expect(result.stdout).toContain("Then run: stateward check");
    expect(result.stdout).not.toContain(NEXT_FIRST_RULE);
  });

  it("counts a .tsx under src and a file listed in tsconfig as code, and .d.ts or node_modules as not", async () => {
    mkdirSync(path.join(dir, "src", "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "src", "types.d.ts"), "export {};\n");
    writeFileSync(path.join(dir, "src", "node_modules", "x.ts"), "export {};\n");
    expect((await init(["", ""])).prompts).toBe(2);
    rmSync(path.join(dir, "stateward.config.ts"));

    writeFileSync(path.join(dir, "src", "App.tsx"), "export const A = 1;\n");
    expect((await init(["", "", ""])).prompts).toBe(3);
    rmSync(path.join(dir, "stateward.config.ts"));
    rmSync(path.join(dir, "src"), { recursive: true });

    writeFileSync(path.join(dir, "main.ts"), "export {};\n");
    writeFileSync(path.join(dir, "tsconfig.json"), '{ "files": ["main.ts"] }');
    expect((await init(["", "", ""])).prompts).toBe(3);
  });

  it("asks about React Router only with react-router in package.json and react-context chosen", async () => {
    writeManifest({ react: "^19", "react-router": "^7" });
    const yes = await init(["", "", ""]);
    expect(yes.transcript).toContain("React Router found.");
    expect(yes.transcript).toContain("Add it? [Y/n] ");
    expect(config()).toContain('addons: ["react-context/react-router"],');
    rmSync(path.join(dir, "stateward.config.ts"));

    const no = await init(["", "", "n"]);
    expect(no.prompts).toBe(3);
    expect(config()).not.toContain("addons");
    expect(no.stdout).not.toContain("add-ons");
    rmSync(path.join(dir, "stateward.config.ts"));

    // react-context toggled off: no question.
    const off = await init(["4", ""]);
    expect(off.prompts).toBe(2);
    expect(off.transcript).not.toContain("React Router");
    rmSync(path.join(dir, "stateward.config.ts"));

    // react-context without react-router in package.json: no question.
    writeManifest({ react: "^19" });
    expect((await init(["", ""])).prompts).toBe(2);
  });

  it("--packs and --preset skip their questions", async () => {
    writeManifest({ react: "^19" });
    writeSource();
    const result = await init(["n"], ["--packs", "unions", "--preset", "strict"]);
    expect(result.prompts).toBe(1);
    expect(result.transcript).not.toContain("Which packs");
    expect(result.transcript).not.toContain("Which preset");
    expect(config()).toContain("plugins: [unions()],");
    expect(config()).toContain('preset: "strict",');
    expect(result.stdout).toContain("packs   unions (from --packs)");
  });

  it("asks nothing when every answer is known or beside the point", async () => {
    const result = await init([], ["--packs", "unions", "--preset", "strict"]);
    expect(result.prompts).toBe(0);
    expect(config()).toContain("plugins: [unions()],");
  });

  it("takes the defaults when the input ends, instead of waiting", async () => {
    writeSource();
    const result = await init([]);
    // Say what failed, not only the exit code.
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(config()).toContain("plugins: [unions(), records(), asyncFlow(), errors()],");
    expect(config()).toContain("rollout: true,");
  });

  it("never asks, and never overwrites, when a config exists", async () => {
    writeFileSync(path.join(dir, "stateward.config.mjs"), "export default {};\n");
    const result = await init(["x"]);
    expect(result.prompts).toBe(0);
    expect(result.stdout).toBe("stateward.config.mjs already exists; nothing written.\n");
  });

  it("does not run the installs", async () => {
    const result = await init(["", ""]);
    expect(result.stdout).toContain(
      "  npm install --save-dev stateward @stateward/plugin-unions @stateward/plugin-records @stateward/plugin-async @stateward/plugin-errors",
    );
  });
});

describe("stateward init, without a terminal or with --yes", () => {
  it("never asks without a terminal: detection and flags, as before", async () => {
    writeManifest({ react: "^19", "react-router": "^7" });
    writeSource();
    const result = await init(undefined);
    expect(result.prompts).toBe(0);
    expect(result.stdout).toContain(
      "packs   unions, records, async, react-context, errors, react (detected from package.json)",
    );
    expect(config()).toContain(
      "plugins: [unions(), records(), asyncFlow(), reactContext(), errors(), react()],",
    );
    expect(config()).not.toContain("addons");
    expect(config()).not.toContain("rollout");
  });

  it("--yes accepts every default and shows no question, even on a terminal", async () => {
    writeManifest({ react: "^19", "react-router": "^7" });
    writeSource();
    const result = await init(["n", "n", "n"], ["--yes"]);
    expect(result.code).toBe(0);
    expect(result.prompts).toBe(0);
    expect(result.transcript).not.toContain("Which packs");
    expect(config()).toContain(
      "plugins: [unions(), records(), asyncFlow(), reactContext(), errors(), react()],",
    );
    expect(config()).toContain('preset: "recommended",');
    expect(config()).toContain('addons: ["react-context/react-router"],');
    expect(config()).toContain("rollout: true,");
    expect(result.stdout).toContain(
      "packs   unions, records, async, react-context, errors, react (detected from package.json)",
    );
    expect(result.stdout).toContain(NEXT_FIRST_RULE);
  });

  it("--yes without a terminal works, and flags still override", async () => {
    writeManifest({ react: "^19" });
    const result = await init(undefined, ["--yes", "--packs", "async", "--preset", "strict"]);
    expect(result.prompts).toBe(0);
    expect(config()).toContain("plugins: [asyncFlow()],");
    expect(config()).toContain('preset: "strict",');
    expect(result.stdout).toContain("Then run: stateward check");
  });
});

describe("a recorded session", () => {
  it("reads like this", async () => {
    writeManifest({ react: "^19", "react-router-dom": "^7" });
    writeSource();
    const result = await init(["5", "2", "", ""]);
    expect(result.transcript).toMatchInlineSnapshot(`
      "
      Which packs do you want?
        1. [x] unions         Every case of a union is handled, and its tag tells the cases apart.
        2. [x] records        Lookup tables and records keyed by a union have every key, once, under a type that names them.
        3. [x] async          An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails.
        4. [x] react-context  A component that needs a context is always rendered under its Provider.
        5. [x] errors         Errors are handled where they can happen: none ignored, none replaced in \`finally\`, no \`Result\` dropped.
        6. [ ] ownership      One owner per piece of shared state and per brand: others call the owner's functions.
        7. [ ] reducers       A reducer reaches every state it declares and can leave every state it enters.
        8. [x] react          Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state.
      Type numbers to toggle (for example 2 4), or press Enter to accept: 5

      Which preset?
        1. recommended  what breaks is an error, what only helps is a hint (default)
        2. strict       every rule an error
      Choose 1 or 2, or press Enter for recommended: 2

      This project already has code. Meeting every rule at once can bury you in findings.
      Turn rules on one at a time? (recommended for existing code) [Y/n] 

      React Router found. The react-router add-on follows your routes to see which providers a page has.
      Add it? [Y/n] 

      Created stateward.config.ts
        packs   unions, records, async, react-context, react (your choice)
        preset  strict
        add-ons react-context/react-router
        rollout on: rules are turned on one at a time (stateward plan, stateward next)

      Install what it imports (npm, from your lockfile; stateward does not run it):
        npm install --save-dev stateward @stateward/plugin-unions @stateward/plugin-records @stateward/plugin-async @stateward/plugin-react-context @stateward/plugin-react

      next: run \`npx stateward next\` to turn on the first rule

      "
    `);
  });
});
