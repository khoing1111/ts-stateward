import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_SUBDIR, PROJECT_CACHE_DIR, defaultCacheDir } from "@stateward/core/internal";
import { main } from "../src/main.js";
import type { CliEnv } from "../src/main.js";

const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));

let cacheDir = "";

beforeEach(() => {
  cacheDir = mkdtempSync(path.join(tmpdir(), "stateward-cache-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
  withCache = true,
  environment: Readonly<Record<string, string>> = {},
) {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd: example,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    environment,
    ...(withCache ? { cacheDir: () => cacheDir } : {}),
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

const cacheFiles = (): string[] => readdirSync(cacheDir);
const withoutTime = (json: string): unknown => {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed === "object" && parsed !== null) Reflect.deleteProperty(parsed, "stats");
  return parsed;
};

describe("stateward check: the disk cache", { timeout: 30_000 }, () => {
  it("says where it keeps the results with --verbose", async () => {
    const { stderr } = await run(["check", "--verbose"]);
    expect(stderr).toContain(`stateward: results cache ${path.relative(example, cacheDir)}`);
    const off = await run(["check", "--verbose", "--no-cache"]);
    expect(off.stderr).toContain("stateward: results are not kept for the next run (--no-cache)");
  });

  it("writes the results once and gives the same output from them", async () => {
    const uncached = await run(["check", "--format", "json"], false);
    const cold = await run(["check", "--format", "json"]);
    expect(cacheFiles()).toHaveLength(1);
    const [file = ""] = cacheFiles();
    const written = statSync(path.join(cacheDir, file)).ino;
    const warm = await run(["check", "--format", "json"]);
    for (const result of [cold, warm]) {
      expect(result.code).toBe(uncached.code);
      expect(result.stderr).toBe("");
      expect(withoutTime(result.stdout)).toEqual(withoutTime(uncached.stdout));
    }
    // Nothing changed: the warm run did not write the file again (a write renames a new file over
    // it; the time only says the file was used), and left no temporary file.
    expect(cacheFiles()).toEqual([file]);
    expect(statSync(path.join(cacheDir, file)).ino).toBe(written);
  });

  it("reads a broken cache file as no cache, never as no findings", async () => {
    const uncached = await run(["check", "--format", "json"], false);
    await run(["check", "--format", "json"]);
    const [file = ""] = cacheFiles();
    const full = path.join(cacheDir, file);
    const text = readFileSync(full, "utf8");
    for (const broken of ["", "{", text.slice(0, text.length / 2), '{"stateward":"0"}']) {
      writeFileSync(full, broken);
      const result = await run(["check", "--format", "json"]);
      expect(withoutTime(result.stdout)).toEqual(withoutTime(uncached.stdout));
    }
    // And the last run repaired it.
    expect(JSON.parse(readFileSync(full, "utf8"))).toHaveProperty("snapshot");
  });

  it("drops what other versions wrote, and keeps the folder under its limit, oldest first", async () => {
    await run(["check"]);
    const [own = ""] = cacheFiles();
    const text = readFileSync(path.join(cacheDir, own), "utf8");
    // Other projects' results in a shared folder: one by another stateward version, two by this
    // one (about 1 KB each), one used long ago and one recently.
    const otherVersion = path.join(cacheDir, "check-00000000000000aa.json");
    writeFileSync(otherVersion, '{"stateward":"0.0.1","implementation":"x","project":"/p"}');
    const old = path.join(cacheDir, "check-00000000000000bb.json");
    const recent = path.join(cacheDir, "check-00000000000000cc.json");
    const filler = text.slice(0, text.indexOf(",")) + ',"filler":"' + "x".repeat(1000) + '"}';
    writeFileSync(old, filler);
    writeFileSync(recent, filler);
    utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
    utimesSync(recent, new Date(2030, 0, 1), new Date(2030, 0, 1));
    // A limit that holds the project's own file and one more.
    const limit = statSync(path.join(cacheDir, own)).size + 1500;
    // A change, so the check writes its results again.
    writeFileSync(path.join(cacheDir, own), "{}");
    await run(["check"], true, { STATEWARD_CACHE_MAX_MB: String(limit / (1024 * 1024)) });
    expect(cacheFiles().sort()).toEqual([own, path.basename(recent)].sort());
  });

  it("neither reads nor writes with --no-cache", async () => {
    const result = await run(["check", "--no-cache"]);
    expect(result.stderr).toBe("");
    expect(cacheFiles()).toEqual([]);
  });
});

describe("stateward check: the disk cache after a rebuild", { timeout: 60_000 }, () => {
  const cli = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  const core = fileURLToPath(new URL("../../core/dist/index.js", import.meta.url));

  /** A project whose plugin package (`team-plugin`) takes its message from a helper module. */
  function project(): string {
    const app = path.join(cacheDir, "app");
    const write = (relative: string, text: string): void => {
      const file = path.join(app, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    };
    write("package.json", '{"name":"app","version":"1.0.0"}');
    write("tsconfig.json", '{"compilerOptions":{"strict":true,"noEmit":true},"include":["src"]}');
    write("src/a.ts", "export const a = 1;\n");
    write(
      "node_modules/team-plugin/package.json",
      '{"name":"team-plugin","version":"0.0.0","type":"module","main":"dist/index.js"}',
    );
    write(
      "node_modules/team-plugin/dist/message.js",
      'export const message = () => "old message";\n',
    );
    write(
      "node_modules/team-plugin/dist/index.js",
      [
        `import { definePlugin, defineRule } from ${JSON.stringify(core)};`,
        'import { message } from "./message.js";',
        "const first = defineRule({",
        '  kind: "file",',
        '  meta: { description: "First.", defaultSeverity: "warning", tier: "core", group: "g", explain: "# team/first\\n" },',
        "  check(ctx) {",
        "    const [statement] = ctx.sourceFile.statements;",
        '    if (statement) ctx.report({ node: statement, message: message(), hint: "a hint" });',
        "  },",
        "});",
        'export const team = definePlugin({ name: "team", description: "Team.", rules: { first } });',
        "",
      ].join("\n"),
    );
    write(
      "stateward.config.mjs",
      [
        `import { defineConfig } from ${JSON.stringify(core)};`,
        'import { team } from "team-plugin";',
        'export default defineConfig({ plugins: [team], preset: "recommended" });',
        "",
      ].join("\n"),
    );
    return app;
  }

  function messages(app: string): string[] {
    const result = spawnSync(process.execPath, [cli, "check", "--format", "json", "--cwd", app], {
      encoding: "utf8",
      env: { ...process.env, STATEWARD_CACHE_DIR: path.join(cacheDir, "c") },
    });
    const parsed: unknown = JSON.parse(result.stdout);
    const findings: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "findings") : undefined;
    return Array.isArray(findings)
      ? findings.map((finding: unknown) =>
          typeof finding === "object" && finding !== null
            ? String(Reflect.get(finding, "message"))
            : "",
        )
      : [];
  }

  it("reports a plugin helper's new text, though the rule's own code and every version are the same", () => {
    const app = project();
    expect(messages(app)).toEqual(["old message"]);
    expect(messages(app)).toEqual(["old message"]);
    writeFileSync(
      path.join(app, "node_modules/team-plugin/dist/message.js"),
      'export const message = () => "new message";\n',
    );
    expect(messages(app)).toEqual(["new message"]);
  });
});

describe("defaultCacheDir", () => {
  const home = path.join(tmpdir(), "a-home");
  const linux = { home, platform: "linux" as const };

  it("is node_modules/.cache/stateward when node_modules exists; STATEWARD_CACHE_DIR wins", () => {
    const project = mkdtempSync(path.join(tmpdir(), "stateward-project-"));
    try {
      expect(defaultCacheDir(project, { STATEWARD_CACHE_DIR: "c" }, linux)).toBe(
        path.join(project, "c"),
      );
      expect(defaultCacheDir(example, {}, linux)).toBe(path.join(example, CACHE_SUBDIR));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  // User trial 1.0.2: an app checked before its packages are installed ran cold every time.
  it("falls back to the user's cache folder keyed by the project's path, else .stateward-cache", () => {
    const project = mkdtempSync(path.join(tmpdir(), "stateward-project-"));
    const other = mkdtempSync(path.join(tmpdir(), "stateward-project-"));
    try {
      const dir = defaultCacheDir(project, {}, linux);
      expect(path.dirname(dir)).toBe(path.join(home, ".cache", "stateward", "results"));
      expect(path.basename(dir)).toMatch(new RegExp(`^${path.basename(project)}-[0-9a-f]{16}$`));
      expect(defaultCacheDir(project, {}, linux)).toBe(dir);
      expect(defaultCacheDir(other, {}, linux)).not.toBe(dir);
      expect(
        path.dirname(defaultCacheDir(project, { XDG_CACHE_HOME: path.join(home, "xdg") }, linux)),
      ).toBe(path.join(home, "xdg", "stateward", "results"));
      expect(path.dirname(defaultCacheDir(project, {}, { home, platform: "darwin" }))).toBe(
        path.join(home, "Library", "Caches", "stateward", "results"),
      );
      expect(defaultCacheDir(project, {}, { home: "", platform: "linux" })).toBe(
        path.join(project, PROJECT_CACHE_DIR),
      );
      expect(defaultCacheDir(project, {}, { home, platform: "win32" })).toBe(
        path.join(project, PROJECT_CACHE_DIR),
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
