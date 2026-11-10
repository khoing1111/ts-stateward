import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The release script's decisions are in a module of the repository's scripts, run as it runs them. */
const module = new URL("../../../scripts/release-lib.mjs", import.meta.url).href;

/** Runs a snippet with the module's exports in scope and returns what it prints, parsed. */
function evaluate(expression: string): unknown {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import * as m from ${JSON.stringify(module)}; console.log(JSON.stringify(${expression}));`,
    ],
    { encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

describe("the release script's decisions", () => {
  it("finds the public clone beside the private one, or where the variables say", () => {
    const root = JSON.stringify(path.join("work", "stateward"));
    expect(evaluate(`m.places({}, ${root})`)).toEqual({
      workspace: "work",
      publicClone: path.join("work", "ts-stateward"),
    });
    expect(evaluate(`m.places({ STATEWARD_WORKSPACE: "ws" }, ${root}).publicClone`)).toBe(
      path.join("ws", "ts-stateward"),
    );
    expect(evaluate(`m.places({ STATEWARD_PUBLIC_CLONE: "pub" }, ${root}).publicClone`)).toBe(
      "pub",
    );
  });

  it("sends a release candidate to next and a release to latest", () => {
    expect(evaluate(`[m.npmTag("1.2.0-rc.2"), m.npmTag("1.2.0")]`)).toEqual(["next", "latest"]);
  });

  it("reads owner/name from https and ssh remotes, and nothing from another host", () => {
    expect(
      evaluate(
        `[m.repoOf("https://github.com/khoing1111/ts-stateward"), m.repoOf("git@github.com:khoing1111/ts-stateward.git\\n"), m.repoOf("https://example.com/a/b") ?? null]`,
      ),
    ).toEqual(["khoing1111/ts-stateward", "khoing1111/ts-stateward", null]);
  });

  it("points the notes' links to files at the tagged snapshot, and leaves other links", () => {
    const text = JSON.stringify(
      "Upgrading: [up](docs/user/upgrading.md). [log](./CHANGELOG.md) [npm](https://npmjs.com) [x](#top)",
    );
    expect(evaluate(`m.notesForGitHub(${text}, "o/r", "v1.2.0")`)).toBe(
      "Upgrading: [up](https://github.com/o/r/blob/v1.2.0/docs/user/upgrading.md). [log](https://github.com/o/r/blob/v1.2.0/CHANGELOG.md) [npm](https://npmjs.com) [x](#top)",
    );
  });
});
