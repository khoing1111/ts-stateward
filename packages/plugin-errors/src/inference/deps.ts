import type { EditorContributions, FactSource, Json, LibraryUse } from "@stateward/core";
import { TREE_RULES, throwsOf } from "../react/boundaries.js";
import { readSummary } from "./summary.js";
import type { Effect, PackageFacts } from "./summary.js";

type LibraryFacts = NonNullable<EditorContributions["libraryFacts"]>;

/** The rules whose summaries hold the throws facts; the first that ran is read. */
export const FACT_RULES = ["errors/throws-doc-mismatch"] as const;

function collect(effects: readonly Effect[], into: PackageFacts[]): void {
  for (const effect of effects) {
    if (effect.k === "package") into.push(effect.facts);
    else if (effect.k === "try") {
      collect(effect.body, into);
      collect(effect.fin, into);
      const handler = effect.handler;
      if (handler !== null) {
        collect(handler.pre, into);
        for (const branch of handler.branches) collect(branch.body, into);
        collect(handler.otherwise ?? [], into);
        collect(handler.after, into);
      }
    }
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every package function the project calls, with where its throws facts come from and why what
 * is unknown is unknown (`stateward deps`), from the last full check.
 */
export function packagesCalled(summaries: ReadonlyMap<string, Json>): readonly LibraryUse[] {
  const found: PackageFacts[] = [];
  for (const value of summaries.values()) {
    const summary = readSummary(value);
    if (summary === undefined) continue;
    for (const fact of summary.functions) {
      collect(fact.body, found);
      collect(fact.returns, found);
    }
    collect(summary.module, found);
  }
  const byPackage = new Map<
    string,
    { version: string; functions: Map<string, { source: FactSource; unknown: Set<string> }> }
  >();
  for (const facts of found) {
    const key = `${facts.name}\u0000${facts.version}`;
    const entry = byPackage.get(key) ?? {
      version: facts.version,
      functions: new Map<string, { source: FactSource; unknown: Set<string> }>(),
    };
    byPackage.set(key, entry);
    const fn = entry.functions.get(facts.fn) ?? {
      source: facts.source,
      unknown: new Set<string>(),
    };
    entry.functions.set(facts.fn, fn);
    for (const reason of [...facts.throws.unknown, ...facts.rejects.unknown])
      fn.unknown.add(reason);
  }
  return [...byPackage]
    .sort(([a], [b]) => compare(a, b))
    .map(([key, entry]) => ({
      package: key.slice(0, key.indexOf("\u0000")),
      version: entry.version,
      functions: [...entry.functions]
        .sort(([a], [b]) => compare(a, b))
        .map(([name, fn]) => ({ name, source: fn.source, unknown: [...fn.unknown].sort() })),
    }));
}

export const libraryFacts: LibraryFacts = (input) => {
  let summaries: ReadonlyMap<string, Json> | undefined;
  for (const ruleId of FACT_RULES) summaries ??= input.projectSummaries(ruleId);
  for (const ruleId of TREE_RULES) {
    const trees = summaries === undefined ? input.projectSummaries(ruleId) : undefined;
    if (trees !== undefined) summaries = throwsOf(trees);
  }
  return summaries === undefined ? [] : packagesCalled(summaries);
};
