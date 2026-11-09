import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/file-names.mjs", import.meta.url));

function check(files: readonly string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [script, "--stdin"], {
    input: files.join("\n"),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

// A fixture `Feed.tsx` beside `feed.ts` broke a clone on macOS.
describe("the gate's file-name check", () => {
  it("fails on names that differ only by case, files or folders, and on a .ts and .tsx pair", () => {
    expect(
      check(["a/Feed.tsx", "a/feed.ts", "b/X/y.ts", "b/x/z.ts", "c/Read.md", "c/read.md"]),
    ).toEqual({
      status: 1,
      stderr:
        "b/X and b/x differ only by case\nc/Read.md and c/read.md differ only by case\na/Feed.tsx and a/feed.ts have the same name but for .ts and .tsx\nRename one of each pair.\n",
    });
  });

  it("passes distinct names, and a declaration file beside its source", () => {
    expect(check(["a/feed.ts", "a/FeedList.tsx", "c/m.ts", "c/m.d.ts"])).toEqual({
      status: 0,
      stderr: "",
    });
  });

  it("passes this repository", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
