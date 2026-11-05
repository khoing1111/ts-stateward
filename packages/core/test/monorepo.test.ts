import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsconfigError, check, emptyCache, parseConfig } from "../src/internal.js";
import type { Finding, ProjectRule, Rule } from "../src/internal.js";
import { fixturePath } from "./fixture-path.js";
import { literalProbe, meta, plugin } from "./probe-plugin.js";

const fixture = fixturePath("monorepo");

function configOf(
  tsconfig: string | readonly string[],
  rules: Record<string, Rule>,
  dir = fixture,
) {
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin(rules)], tsconfig }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

function where(findings: readonly Finding[], root: string): string[] {
  return findings.map(
    (f) => `${path.relative(root, f.location.file).split(path.sep).join("/")} ${f.message}`,
  );
}

/** Reports, once, every file whose summary it was given: what a project rule sees. */
const seesAll: ProjectRule = {
  kind: "project",
  meta,
  summarize: (ctx) => path.basename(ctx.file),
  check(summaries, ctx) {
    const names = [...summaries.values()].filter(
      (value): value is string => typeof value === "string",
    );
    const first = [...summaries.keys()][0];
    if (first === undefined) return;
    ctx.report({
      message: names.join(","),
      hint: "h",
      location: { file: first, start: 0, end: 0 },
    });
  },
};

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("several tsconfigs in one config", () => {
  it("checks each tsconfig a glob matches as its own project, a shared file once", () => {
    const config = configOf("packages/*/tsconfig.json", { literals: literalProbe });
    const result = check({ config, cwd: fixture });
    expect(where(result.findings, fixture)).toEqual([
      'packages/a/src/a.ts probeA: "a"',
      'packages/b/src/b.ts probeB: "s"',
      'shared/both.ts probeShared: "s"',
    ]);
    expect(result.stats.files).toBe(3);
    // The shared file is checked in the first project, a; the glob's matches are sorted.
    expect(
      result.stats.projects?.map(({ tsconfig, files }) => [
        path.relative(fixture, tsconfig).split(path.sep).join("/"),
        files,
      ]),
    ).toEqual([
      ["packages/a/tsconfig.json", 2],
      ["packages/b/tsconfig.json", 1],
    ]);
  });

  it("keeps the order of a list, and gives the same findings whatever the order", () => {
    const forward = check({
      config: configOf(["packages/a/tsconfig.json", "packages/b/tsconfig.json"], {
        literals: literalProbe,
      }),
      cwd: fixture,
    });
    const backward = check({
      config: configOf(["packages/b/tsconfig.json", "packages/a/tsconfig.json"], {
        literals: literalProbe,
      }),
      cwd: fixture,
    });
    expect(backward.findings).toEqual(forward.findings);
    expect(backward.stats.projects?.map((p) => path.basename(path.dirname(p.tsconfig)))).toEqual([
      "b",
      "a",
    ]);
    // Twice the same input: the same findings in the same order.
    expect(
      check({
        config: configOf(["packages/*/tsconfig.json"], { literals: literalProbe }),
        cwd: fixture,
      }).findings,
    ).toEqual(forward.findings);
  });

  it("gives a project rule the summaries of every project", () => {
    const result = check({
      config: configOf(["packages/*/tsconfig.json"], { all: seesAll }),
      cwd: fixture,
    });
    expect(result.findings.map((f) => f.message)).toEqual(["a.ts,b.ts,both.ts"]);
  });

  it("says which project decided an import, only for a file two projects list", () => {
    const config = configOf(["packages/*/tsconfig.json"], {});
    const missing = 'import { gone } from "not-installed";\nexport const probeShared = gone;\n';
    const overlays = new Map([
      [path.join(fixture, "shared", "both.ts"), missing],
      [path.join(fixture, "packages", "b", "src", "b.ts"), `${missing}export const probeB = 1;\n`],
    ]);
    const hints = check({ config, cwd: fixture, overlays }).findings.map(
      (f) => `${path.basename(f.location.file)}: ${f.hint}`,
    );
    expect(hints).toEqual([
      "b.ts: install the project's packages (or build its workspace packages) and check again",
      "both.ts: install the project's packages (or build its workspace packages) and check again (checked as part of `packages/a/tsconfig.json`)",
    ]);
  });

  it("says a glob that matches no tsconfig is wrong, with the fix", () => {
    const config = configOf(["packages/*/tsconfig.json", "apps/*/tsconfig.json"], {
      literals: literalProbe,
    });
    const run = (): unknown => check({ config, cwd: fixture });
    expect(run).toThrow(TsconfigError);
    expect(run).toThrow("no tsconfig matches `apps/*/tsconfig.json`");
  });

  it("shows the unmatched glob exactly as written in the config", () => {
    const config = configOf(["./packages/*/tsconfig.json", "./apps/*/tsconfig.json"], {
      literals: literalProbe,
    });
    expect(() => check({ config, cwd: fixture })).toThrow(
      "no tsconfig matches `./apps/*/tsconfig.json`",
    );
  });

  it("refuses a tsconfig that is neither a path nor a list of them", () => {
    expect(parseConfig({ preset: "recommended", plugins: [], tsconfig: [] }, fixture)).toEqual({
      ok: false,
      errors: [
        'tsconfig must be a path or a list of paths and globs, like "tsconfig.json" or ["packages/*/tsconfig.json"]',
      ],
    });
  });

  it("keeps the cache per project: an edit in one package runs the rules on that package only", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-monorepo-"));
    temporary.push(dir);
    cpSync(fixture, dir, { recursive: true });
    const ran: string[] = [];
    const counting: Rule = {
      kind: "file",
      meta,
      check: (ctx) => {
        ran.push(path.relative(dir, ctx.file).split(path.sep).join("/"));
      },
    };
    const config = configOf(["packages/*/tsconfig.json"], { counting, all: seesAll }, dir);
    const cache = emptyCache();
    const first = check({ config, cwd: dir, cache });
    expect(ran.sort()).toEqual(["packages/a/src/a.ts", "packages/b/src/b.ts", "shared/both.ts"]);
    expect(
      [...cache.programs.keys()].map((key) => path.basename(path.dirname(key))).sort(),
    ).toEqual(["a", "b"]);

    ran.length = 0;
    writeFileSync(
      path.join(dir, "packages", "a", "src", "a.ts"),
      'export const probeA = "edited";\n',
    );
    const second = check({ config, cwd: dir, cache });
    expect(ran).toEqual(["packages/a/src/a.ts"]);
    expect(second.findings.map((f) => f.message)).toEqual(first.findings.map((f) => f.message));
  });
});
