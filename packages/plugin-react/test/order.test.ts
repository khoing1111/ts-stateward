import { describe, expect, it } from "vitest";
import type { Finding, Location, RelatedLocation } from "@stateward/core";
import type { ReactSummary } from "../src/index.js";
import { dependencyChangesEveryRender } from "../src/dependency-changes-every-render.js";

const site = { start: 10, end: 20, line: 3 };
const call = { at: site, name: null, text: "useB()", args: [], freshArgs: [] };

const summaries: readonly (readonly [string, ReactSummary])[] = [
  [
    "/app/src/a.ts",
    {
      compiled: false,
      functions: [
        {
          id: "src/a.ts#useA",
          name: "useA",
          hook: true,
          returns: [
            {
              path: ["x"],
              origin: { kind: "from", fn: "src/b.ts#useB", path: ["x"], except: [], call },
            },
            {
              path: ["f"],
              origin: {
                kind: "fresh",
                what: "function",
                at: site,
                label: "f",
                closure: null,
                derived: [],
              },
            },
          ],
        },
      ],
      dependencies: [],
    },
  ],
  [
    "/app/src/b.ts",
    {
      compiled: false,
      functions: [
        {
          id: "src/b.ts#useB",
          name: "useB",
          hook: true,
          returns: [
            {
              path: ["x"],
              origin: { kind: "from", fn: "src/a.ts#useA", path: ["f"], except: [], call },
            },
          ],
        },
      ],
      dependencies: [],
    },
  ],
  [
    "/app/src/Page.tsx",
    {
      compiled: false,
      functions: [],
      dependencies: [
        {
          at: { start: 5, end: 6 },
          text: "x",
          in: "Page",
          target: { kind: "hook", hook: "useEffect" },
          called: false,
          via: { kind: "from", fn: "src/a.ts#useA", path: ["x"], source: "useA()", call },
        },
      ],
    },
  ],
];

/** What the project rule reports from these summaries, in this order of files. */
function run(order: readonly (readonly [string, ReactSummary])[]): Finding[] {
  const findings: Finding[] = [];
  for (const key of ["dependency-changes-every-render"] as const) {
    const rule = { "dependency-changes-every-render": dependencyChangesEveryRender }[key];
    const ruleId = `react/${key}`;
    rule.check(new Map(order), {
      options: {
        memoProps: true,
        ignore: [],
        stableHooks: [],
        stableFunctions: [],
        severities: {},
      },
      report(problem: {
        message: string;
        hint: string;
        location: Location;
        related?: readonly RelatedLocation[];
      }) {
        findings.push({
          kind: "problem",
          ruleId,
          severity: "warning",
          fixes: [],
          related: problem.related ?? [],
          ...problem,
        });
      },
      unknown(input) {
        findings.push({ kind: "unknown", ruleId, ...input });
      },
    });
  }
  return findings;
}

describe("react: project rules decide from summaries alone", () => {
  it("follows a cycle between two hooks, and gives the same findings in any file order and after JSON", () => {
    // Lossless through JSON (the cache stores summaries as JSON), so a copy stands for the cached one.
    for (const [, summary] of summaries)
      expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    const roundTripped = summaries.map(
      ([file, summary]) => [file, structuredClone(summary)] as const,
    );
    const findings = run(summaries);
    expect(findings.map((finding) => finding.message)).toEqual([
      "`x` from `useA()` is a new function every render, so this effect runs after every render",
    ]);
    expect(run([...summaries].reverse())).toEqual(findings);
    expect(run(roundTripped)).toEqual(findings);
  });
});
