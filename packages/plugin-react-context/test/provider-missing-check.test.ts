import { describe, expect, it } from "vitest";
import type { Location, ProjectContext } from "@stateward/core";
import { checkSummaries } from "../src/provider-missing/check.js";
import type { EntryPoint } from "../src/provider-missing/options.js";
import type {
  ComponentRender,
  ComponentSummary,
  Loc,
  SlotPosition,
  Summary,
} from "../src/provider-missing/summary.js";

/** The check works on summaries alone, so these tests build them by hand: no TypeScript here. */

type Reported = { message: string; hint: string; at: string; notes: string[] };

function loc(file: string, start: number): Loc {
  return { file, start, end: start + 1 };
}

function at(location: Location): string {
  return `${location.file}@${String(location.start)}`;
}

function run(summaries: Map<string, Summary>, entries: readonly EntryPoint[] = []) {
  const problems: Reported[] = [];
  const unknowns: Reported[] = [];
  const ctx: ProjectContext = {
    options: {},
    report: (problem) => {
      const notes = (problem.related ?? []).map((note) => `${at(note.location)} ${note.message}`);
      problems.push({
        message: problem.message,
        hint: problem.hint,
        at: at(problem.location),
        notes,
      });
    },
    unknown: (input) => {
      unknowns.push({
        message: input.message,
        hint: input.hint,
        at: at(input.location),
        notes: [],
      });
    },
  };
  checkSummaries(summaries, entries, ctx);
  return { problems, unknowns };
}

const empty: Summary = {
  contexts: [],
  components: [],
  hooks: [],
  entries: [],
  entryCalls: [],
  unknowns: [],
  routes: [],
  externalContexts: [],
  guards: [],
  declared: [],
};

function component(id: string, over: Partial<ComponentSummary> = {}): ComponentSummary {
  return {
    id,
    name: id,
    loc: loc(`${id}.tsx`, 0),
    exports: [],
    wraps: null,
    reads: [],
    hooks: [],
    renders: [],
    slots: [],
    ...over,
  };
}

function renders(id: string, start: number, under: string[] = []): ComponentRender {
  return {
    kind: "component",
    id,
    name: id,
    loc: loc("site.tsx", start),
    under,
    via: [],
    origin: null,
  };
}

const AUTH = {
  id: "auth",
  name: "AuthCtx",
  loc: loc("ctx.ts", 0),
  stated: false,
  declare: null,
};
const read = { context: "auth", loc: loc("read.tsx", 7) };

function files(summary: Summary): Map<string, Summary> {
  return new Map([["a.tsx", summary]]);
}

describe("provider-missing check (pure)", () => {
  it("takes needs through a recursion between two components", () => {
    const summary: Summary = {
      ...empty,
      contexts: [AUTH],
      components: [
        component("A", { renders: [renders("B", 1)] }),
        component("B", { renders: [renders("A", 2), renders("C", 3)] }),
        component("C", { reads: [read] }),
      ],
      entries: [{ loc: loc("main.tsx", 9), render: renders("A", 9) }],
    };
    const { problems } = run(files(summary));
    expect(problems.map((problem) => [problem.message, problem.at])).toEqual([
      ["`<A>` is rendered without `AuthCtx.Provider`", "site.tsx@9"],
    ]);
    expect(problems[0]?.notes).toEqual([
      "site.tsx@1 `<B>` is rendered",
      "site.tsx@3 `<C>` is rendered",
      "read.tsx@7 `C` reads `AuthCtx`",
    ]);
  });

  it("does not report a Provider that sits around the render", () => {
    const summary: Summary = {
      ...empty,
      contexts: [AUTH],
      components: [
        component("A", { renders: [renders("C", 1, ["auth"])] }),
        component("C", { reads: [read] }),
      ],
      entries: [{ loc: loc("main.tsx", 9), render: renders("A", 9) }],
    };
    expect(run(files(summary)).problems).toEqual([]);
  });

  it("asks nothing of a slot the owner never renders, and renders the slot at each position", () => {
    const viaLayout = { owner: "Layout", name: "children" };
    const given = (): ComponentRender => ({ ...renders("C", 4), via: [viaLayout] });
    const app = (): ComponentSummary => component("App", { renders: [given()] });
    const layout = (positions: SlotPosition[]): ComponentSummary =>
      component("Layout", { slots: [{ name: "children", positions }] });
    const base = {
      ...empty,
      contexts: [AUTH],
      entries: [{ loc: loc("m.tsx", 9), render: renders("App", 9) }],
    };

    const never = { ...base, components: [app(), layout([]), component("C", { reads: [read] })] };
    expect(run(files(never)).problems).toEqual([]);

    const both = [
      { under: ["auth"], via: [], loc: loc("l.tsx", 1) },
      { under: [], via: [], loc: loc("l.tsx", 2) },
    ];
    const twice = { ...base, components: [app(), layout(both), component("C", { reads: [read] })] };
    expect(run(files(twice)).problems.map((problem) => problem.notes)).toEqual([
      [
        "site.tsx@4 `<C>` is rendered",
        "l.tsx@2 `Layout` renders its `children` outside the Provider",
        "read.tsx@7 `C` reads `AuthCtx`",
      ],
    ]);
  });

  it("gives the same findings whatever order the files are read in", () => {
    const first: Summary = {
      ...empty,
      contexts: [AUTH],
      components: [component("A", { renders: [renders("B", 1)] })],
      entries: [{ loc: loc("m.tsx", 9), render: renders("A", 9) }],
    };
    const second: Summary = { ...empty, components: [component("B", { reads: [read] })] };
    const forward = run(
      new Map([
        ["a.tsx", first],
        ["b.tsx", second],
      ]),
    );
    const backward = run(
      new Map([
        ["b.tsx", second],
        ["a.tsx", first],
      ]),
    );
    expect(backward).toEqual(forward);
    expect(forward.problems).toHaveLength(1);
  });

  it("says nothing when the project has no required context", () => {
    const summary: Summary = { ...empty, components: [component("A", { reads: [read] })] };
    expect(run(files(summary))).toEqual({ problems: [], unknowns: [] });
  });

  it("matches a configured entry by file suffix and export name", () => {
    const summary: Summary = {
      ...empty,
      contexts: [AUTH],
      components: [
        component("App", { loc: loc("/repo/src/App.tsx", 3), exports: ["App"], reads: [read] }),
      ],
    };
    const entries: EntryPoint[] = [{ file: "src/App.tsx", export: "App", provides: ["AuthCtx"] }];
    expect(run(files(summary), entries)).toEqual({ problems: [], unknowns: [] });
  });
});
