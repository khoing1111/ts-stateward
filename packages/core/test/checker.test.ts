import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "../src/internal.js";
import type { CheckProgress, FileRule, Plugin, ProjectRule } from "../src/internal.js";
import { fixturePath, posix } from "./fixture-path.js";
import { callProbe, plugin as probe } from "./probe-plugin.js";

const dir = fixturePath("probe");
const a = path.join(dir, "a.ts");
const b = path.join(dir, "b.ts");

const editorPlugin: Plugin = {
  name: "ed",
  description: "editor probe",
  rules: {},
  editor: {
    hover: ({ file, offset, sourceFile }) =>
      `${path.basename(file)}@${String(offset)}/${String(sourceFile.statements.length)}`,
    tokens: ({ file }) => [{ location: { file, start: 0, end: 6 }, type: "keyword" }],
  },
};

function checker(plugins: readonly Plugin[]) {
  const parsed = parseConfig({ preset: "recommended", plugins }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir });
}

describe("createChecker", () => {
  it("collects hovers and tokens from plugins, building the programs if no check ran", () => {
    const editor = checker([editorPlugin, { name: "quiet", description: "quiet", rules: {} }]);
    expect(editor.hover(a, 3)).toEqual(["a.ts@3/2"]);
    expect(editor.tokens(a)).toEqual([
      { location: { file: a, start: 0, end: 6 }, type: "keyword" },
    ]);
  });

  it("hands editor contributions the project summaries of the last full check, a new Map when they change", () => {
    const seen: (ReadonlyMap<string, unknown> | undefined)[] = [];
    const summing: Plugin = {
      name: "sum",
      description: "keeps summaries",
      rules: {
        total: {
          kind: "project",
          meta: {
            description: "t",
            defaultSeverity: "error",
            tier: "core",
            group: "g",
            explain: "t",
          },
          summarize: ({ sourceFile }) => sourceFile.text.length,
          check: () => undefined,
        },
      },
      editor: {
        hover: (input) => {
          seen.push(input.projectSummaries("sum/total"));
          return undefined;
        },
      },
    };
    const editor = checker([summing]);
    editor.hover(a, 0);
    editor.check();
    editor.hover(a, 0);
    editor.hover(a, 0);
    editor.check();
    editor.hover(a, 0);
    editor.check(new Map([[a, "export const longer = 1;\n"]]));
    editor.hover(a, 0);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]?.get(posix(a))).toBe(readFileSync(a, "utf8").length);
    expect(seen[2]).toBe(seen[1]);
    // Nothing changed: the same Map, so what a plugin derived from it stays valid.
    expect(seen[3]).toBe(seen[1]);
    expect(seen[4]).not.toBe(seen[1]);
    expect(seen[4]?.get(posix(a))).toBe("export const longer = 1;\n".length);
  });

  it("answers nothing for a file outside the checked set", () => {
    const editor = checker([editorPlugin]);
    const outside = path.join(dir, "skipped.test.ts");
    expect(editor.hover(outside, 0)).toEqual([]);
    expect(editor.tokens(outside)).toEqual([]);
  });

  it("answers editor requests from the programs of the last check, overlays included", () => {
    const editor = checker([editorPlugin]);
    editor.check(new Map([[b, "export const only = 1;\n"]]));
    expect(editor.hover(b, 0)).toEqual(["b.ts@0/1"]);
  });

  it("checks again with new overlays and gives what a fresh checker gives", () => {
    const reused = checker([probe({ calls: callProbe })]);
    const messages = (checked: ReturnType<typeof reused.check>): string[] =>
      checked.findings.map((f) => f.message);
    const overlay = new Map([[b, 'import { greet } from "./a.js";\ngreet("o");\n']]);

    const first = messages(reused.check());
    expect(first).toHaveLength(5);
    expect(messages(reused.check(overlay))).toEqual(['greet|greet|a.ts|true|"o"']);
    expect(messages(checker([probe({ calls: callProbe })]).check(overlay))).toEqual([
      'greet|greet|a.ts|true|"o"',
    ]);
    expect(messages(reused.check())).toEqual(first);
  });

  describe("checkFiles", () => {
    const projectRule: ProjectRule = {
      kind: "project",
      meta: { description: "p", defaultSeverity: "error", tier: "core", group: "g", explain: "p" },
      summarize: () => 1,
      check: (summaries, ctx) => {
        for (const file of summaries.keys()) {
          ctx.report({ message: "project", hint: "h", location: { file, start: 0, end: 0 } });
        }
      },
    };
    const both = (): ReturnType<typeof checker> =>
      checker([probe({ calls: callProbe, whole: projectRule })]);

    it("runs file rules on the given files only and gives what check gives for them", () => {
      const editor = both();
      const full = editor.check().findings.filter((f) => f.ruleId === "probe/calls");
      const fast = editor.checkFiles([b]);
      expect(fast.findings).toEqual(full.filter((f) => posix(f.location.file).endsWith("/b.ts")));
      expect(fast.findings.length).toBeGreaterThan(0);
      expect(fast.stats.files).toBe(1);
    });

    it("runs no project rule and names them", () => {
      const editor = both();
      expect(editor.checkFiles([a, b]).findings.map((f) => f.ruleId)).not.toContain("probe/whole");
      expect([...editor.projectRuleIds]).toEqual(["probe/whole"]);
    });

    it("sees overlays, ignores files outside the checked set, and accepts backslash paths", () => {
      const editor = both();
      const overlay = new Map([[b, 'import { greet } from "./a.js";\ngreet("o");\n']]);
      const outside = path.join(dir, "skipped.test.ts");
      const fast = editor.checkFiles([b, outside, b.replaceAll("/", "\\")], overlay);
      expect(fast.findings.map((f) => f.message)).toEqual(['greet|greet|a.ts|true|"o"']);
    });
  });
  describe("checkInSlices", () => {
    const projectRule: ProjectRule = {
      kind: "project",
      meta: { description: "p", defaultSeverity: "error", tier: "core", group: "g", explain: "p" },
      summarize: () => 1,
      check: (summaries, ctx) => {
        for (const file of summaries.keys()) {
          ctx.report({ message: "project", hint: "h", location: { file, start: 0, end: 0 } });
        }
      },
    };

    it("gives what check gives, pausing after the programs, every rule on a file, every file and project rule", async () => {
      const plugins = [probe({ calls: callProbe, whole: projectRule })];
      const seen: CheckProgress[] = [];
      const sliced = await checker(plugins).checkInSlices(new Map(), {
        cancelled: () => false,
        progress: (at) => seen.push(at),
        sliceMs: 0,
      });
      const plain = checker(plugins).check();
      expect(sliced.kind === "done" && sliced.result.findings).toEqual(plain.findings);
      // The engine names files as TypeScript does, with `/`.
      const fileA = a.split(path.sep).join("/");
      const fileB = b.split(path.sep).join("/");
      expect(seen).toEqual([
        { phase: "files", done: 0, total: 2 },
        { phase: "files", done: 0, total: 2, file: fileA, rule: "probe/calls" },
        { phase: "files", done: 0, total: 2, file: fileA, rule: "probe/whole" },
        { phase: "files", done: 1, total: 2 },
        { phase: "files", done: 1, total: 2, file: fileB, rule: "probe/calls" },
        { phase: "files", done: 1, total: 2, file: fileB, rule: "probe/whole" },
        { phase: "files", done: 2, total: 2 },
      ]);
    });

    it("stops when cancelled, and the next run reuses what the finished files computed", async () => {
      const ran: string[] = [];
      const counting: FileRule = {
        kind: "file",
        meta: callProbe.meta,
        check: (ctx) => {
          ran.push(path.basename(ctx.file));
        },
      };
      const editor = checker([probe({ counting })]);
      let stop = false;
      const stopped = await editor.checkInSlices(new Map(), {
        cancelled: () => stop,
        progress: (at) => {
          if (at.done === 1) stop = true;
        },
        sliceMs: 0,
      });
      expect(stopped.kind).toBe("cancelled");
      expect(ran).toEqual(["a.ts"]);
      const done = await editor.checkInSlices(new Map(), { cancelled: () => false });
      expect(done.kind).toBe("done");
      expect(ran).toEqual(["a.ts", "b.ts"]);
    });

    it("does not start when already cancelled", async () => {
      const editor = checker([probe({ calls: callProbe })]);
      expect(await editor.checkInSlices(new Map(), { cancelled: () => true })).toEqual({
        kind: "cancelled",
        longest: { ms: 0, at: undefined },
      });
    });

    it("stops between two rules on one file, and says which step took longest", async () => {
      const ran: string[] = [];
      const rule = (name: string): FileRule => ({
        kind: "file",
        meta: callProbe.meta,
        check: (ctx) => {
          ran.push(`${name} ${path.basename(ctx.file)}`);
        },
      });
      const editor = checker([probe({ first: rule("first"), second: rule("second") })]);
      let stop = false;
      const stopped = await editor.checkInSlices(new Map(), {
        cancelled: () => stop,
        progress: (at) => {
          if (at.rule !== undefined) stop = true;
        },
        sliceMs: 0,
      });
      expect(stopped.kind).toBe("cancelled");
      expect(ran).toEqual(["first a.ts"]);
      expect(stopped.longest.ms).toBeGreaterThan(0);
    });
  });
});
