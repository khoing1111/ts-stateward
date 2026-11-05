import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createChecker, createPropagationMemo, parseConfig, propagate } from "../src/internal.js";
import type { Plugin, Propagation, Rule } from "../src/internal.js";
import { fixturePath } from "./fixture-path.js";

type Facts = Readonly<Record<string, { own: readonly string[]; calls: readonly string[] }>>;

/** What each node reaches: its own letters and its callees'. */
function problem(facts: Facts): Propagation<readonly string[], ReadonlySet<string>> {
  return {
    nodes: Object.keys(facts),
    successors: (node) => facts[node]?.calls ?? [],
    input: (node) => facts[node]?.own ?? [],
    sameInput: (a, b) => a.join() === b.join(),
    compute: (node, resultOf) => {
      const found = new Set(facts[node]?.own ?? []);
      for (const callee of facts[node]?.calls ?? []) {
        for (const letter of resultOf(callee) ?? []) found.add(letter);
      }
      return found;
    },
    initial: new Set(),
    same: (a, b) => a.size === b.size && [...a].every((letter) => b.has(letter)),
  };
}

const sorted = (set: ReadonlySet<string> | undefined): string[] => [...(set ?? [])].sort();

describe("propagate", () => {
  it("solves a cycle once for all its members, from what they call", () => {
    const { results } = propagate(
      problem({
        top: { own: [], calls: ["even"] },
        even: { own: ["R"], calls: ["odd"] },
        odd: { own: [], calls: ["even", "leaf"] },
        leaf: { own: ["S"], calls: ["missing"] },
      }),
    );
    expect(sorted(results.get("top"))).toEqual(["R", "S"]);
    expect(sorted(results.get("odd"))).toEqual(["R", "S"]);
    expect(sorted(results.get("leaf"))).toEqual(["S"]);
  });

  it("recomputes nothing when nothing changed, and stops at a node whose result stays", () => {
    const memo = createPropagationMemo<readonly string[], ReadonlySet<string>>();
    const facts: Facts = {
      top: { own: [], calls: ["mid"] },
      mid: { own: [], calls: ["leaf"] },
      leaf: { own: ["A"], calls: [] },
    };
    expect(propagate({ ...problem(facts), memo }).computed).toBe(3);
    const again = propagate({ ...problem(facts), memo });
    expect(again.computed).toBe(0);

    // leaf's body changes, its result does not: mid and top are not computed.
    const edited = { ...facts, leaf: { own: ["A", "A"], calls: [] } };
    const cut = propagate({ ...problem(edited), memo });
    expect(cut.computed).toBe(1);
    expect(cut.results.get("top")).toBe(again.results.get("top"));

    // leaf's result changes: everything above it is computed again.
    const changed = { ...edited, leaf: { own: ["B"], calls: [] } };
    const grown = propagate({ ...problem(changed), memo });
    expect(grown.computed).toBe(3);
    expect(sorted(grown.results.get("top"))).toEqual(["B"]);

    // A new call that makes a cycle: the components are found again.
    const cycle = { ...changed, leaf: { own: ["B"], calls: ["top"] } };
    const solved = propagate({ ...problem(cycle), memo });
    expect(sorted(solved.results.get("leaf"))).toEqual(["B"]);
    expect(solved.computed).toBeGreaterThanOrEqual(3);
    const extra = { ...cycle, top: { own: ["C"], calls: ["mid"] } };
    expect(sorted(propagate({ ...problem(extra), memo }).results.get("leaf"))).toEqual(["B", "C"]);
  });
});

/** Reports the `@throws` tags it sees on each function declaration. */
function tagProbe(needsJsDoc: boolean): Plugin {
  const rule: Rule = {
    kind: "file",
    meta: {
      description: "d",
      defaultSeverity: "error",
      tier: "core",
      group: "g",
      explain: "d",
      ...(needsJsDoc ? { needsJsDoc: true as const } : {}),
    },
    check(ctx) {
      for (const statement of ctx.sourceFile.statements) {
        if (!ts.isFunctionDeclaration(statement)) continue;
        const tags = ts.getJSDocTags(statement).map((tag) => tag.tagName.text);
        ctx.report({ node: statement, message: `tags: ${tags.join(",")}`, hint: "h" });
      }
    },
  };
  return { name: "probe", description: "p", rules: { tags: rule } };
}

function tagsSeen(plugin: Plugin, rules: Record<string, "off"> = {}): string[] {
  const dir = fixturePath("jsdoc");
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin], rules }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: dir, cache: false })
    .check()
    .findings.map((finding) => `${path.basename(finding.location.file)} ${finding.message}`);
}

describe("RuleMeta.needsJsDoc", () => {
  it("parses JSDoc in TypeScript files only when a rule that is on asks for it", () => {
    expect(tagsSeen(tagProbe(false))).toEqual(["a.ts tags: "]);
    expect(tagsSeen(tagProbe(true))).toEqual(["a.ts tags: throws"]);
  });

  it("is checked by the config like the other flags", () => {
    const bad = {
      ...tagProbe(false),
      rules: {
        tags: {
          ...tagProbe(false).rules.tags,
          meta: { ...tagProbe(false).rules.tags?.meta, needsJsDoc: "yes" },
        },
      },
    };
    const parsed = parseConfig({ preset: "recommended", plugins: [bad] }, fixturePath("jsdoc"));
    expect(parsed.ok).toBe(false);
  });
});
