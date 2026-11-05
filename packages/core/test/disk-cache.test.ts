import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDiskCache } from "../src/internal.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-disk-cache-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const PROJECT = "/project";
const CONFIG = "/project/stateward.config.mjs";
const IMPLEMENTATION = "implementation";

/** Core's built module: the writers run in processes of their own, as the CLI and the server do. */
const coreModule = pathToFileURL(
  fileURLToPath(new URL("../dist/internal.js", import.meta.url)),
).href;

/** A process that saves the cache `times` times, adding a large entry before each save. */
function writer(script: string, name: string, times: number): Promise<number | null> {
  const child = spawn(process.execPath, [script, dir, name, String(times)], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", resolve));
}

describe("the results cache on disk", () => {
  it("is always one whole JSON file while two processes write it at once", async () => {
    const script = path.join(dir, "writer.mjs");
    writeFileSync(
      script,
      [
        `import { openDiskCache } from ${JSON.stringify(coreModule)};`,
        "const [dir, name, times] = process.argv.slice(2);",
        "for (let i = 0; i < Number(times); i += 1) {",
        `  const disk = openDiskCache(dir, ${JSON.stringify(PROJECT)}, ${JSON.stringify(CONFIG)}, 1e9, ${JSON.stringify(IMPLEMENTATION)});`,
        '  disk.cache.files.set(`${name}-${i}`, { fingerprint: "f".repeat(20000), rules: new Map(), reads: new Map() });',
        "  disk.cache.changed = true;",
        "  const failed = disk.save();",
        "  if (failed !== undefined) { console.error(failed.message); process.exit(1); }",
        "}",
        "",
      ].join("\n"),
    );
    const both = Promise.all([writer(script, "a", 40), writer(script, "b", 40)]);
    const writing: { running: boolean } = { running: true };
    void both.then(() => (writing.running = false));
    let reads = 0;
    const broken: string[] = [];
    while (writing.running) {
      const file = readdirSync(dir).find((name) => /^check-[0-9a-f]+\.json$/.test(name));
      if (file !== undefined) {
        const text = readFileSync(path.join(dir, file), "utf8");
        reads += 1;
        try {
          JSON.parse(text);
        } catch {
          broken.push(text.slice(0, 80));
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(await both).toEqual([0, 0]);
    expect(broken).toEqual([]);
    expect(reads).toBeGreaterThan(0);
    // Every writer renamed its temporary file: none is left.
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    // The last whole write is what a reader gets: the entries of both writers that it read first.
    const disk = openDiskCache(dir, PROJECT, CONFIG, 1e9, IMPLEMENTATION);
    expect(disk.cache.files.size).toBeGreaterThan(0);
    expect([...disk.cache.files.keys()].every((key) => /^[ab]-\d+$/.test(key))).toBe(true);
  });

  it("keeps the results of two implementations of one project apart", () => {
    const one = openDiskCache(dir, PROJECT, CONFIG, 1e9, "one");
    one.cache.files.set("a.ts", { fingerprint: "f", rules: new Map(), reads: new Map() });
    one.cache.changed = true;
    expect(one.save()).toBeUndefined();
    const two = openDiskCache(dir, PROJECT, CONFIG, 1e9, "two");
    expect(two.cache.files.size).toBe(0);
    two.cache.files.set("b.ts", { fingerprint: "f", rules: new Map(), reads: new Map() });
    two.cache.changed = true;
    expect(two.save()).toBeUndefined();
    // Neither replaced the other's file.
    expect([...openDiskCache(dir, PROJECT, CONFIG, 1e9, "one").cache.files.keys()]).toEqual([
      "a.ts",
    ]);
  });

  describe("when the rename fails", () => {
    function failing(codes: (string | undefined)[]) {
      const calls: string[] = [];
      const waits: number[] = [];
      const disk = openDiskCache(dir, PROJECT, CONFIG, 1e9, IMPLEMENTATION, {
        rename(from, to) {
          const code = codes[calls.length] ?? codes[codes.length - 1];
          calls.push(from);
          if (code !== undefined) throw Object.assign(new Error(`${code}: busy`), { code });
          renameSync(from, to);
        },
        wait: (ms) => waits.push(ms),
      });
      disk.cache.files.set("a.ts", { fingerprint: "f", rules: new Map(), reads: new Map() });
      disk.cache.changed = true;
      return { disk, calls, waits };
    }

    it("tries again after EPERM and saves once it works", () => {
      const { disk, calls, waits } = failing(["EPERM", "EPERM", undefined]);
      expect(disk.save()).toBeUndefined();
      expect(calls).toHaveLength(3);
      expect(waits).toEqual([10, 20]);
      expect(openDiskCache(dir, PROJECT, CONFIG, 1e9, IMPLEMENTATION).cache.files.size).toBe(1);
    });

    it("gives up after a few tries, with the message and no temporary file", () => {
      const { disk, calls } = failing(["EBUSY"]);
      expect(disk.save()?.message).toContain("EBUSY");
      expect(calls).toHaveLength(5);
      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    it("does not try again after another error", () => {
      const { disk, calls } = failing(["ENOENT"]);
      expect(disk.save()?.message).toContain("ENOENT");
      expect(calls).toHaveLength(1);
    });
  });
});
