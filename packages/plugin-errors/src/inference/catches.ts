import { collected, evaluate, inferred } from "./solve.js";
import type { Analysis, CatchSeen } from "./solve.js";

/**
 * Every catch of `file` (of the whole project when `file` is undefined) with what its `try` can
 * throw, whether it branches on `instanceof` or not: the editor's catch-variable hint and
 * the refactoring "Handle the known errors" read these. `catch-misses-error` reads only the catches that branch
 * (`everyCatch`). In source order, one per `catch` keyword.
 */
export function catchesOf(analysis: Analysis, file?: string): readonly CatchSeen[] {
  const found = new Map<string, CatchSeen>();
  const add = (one: CatchSeen): void => {
    const key = `${one.file}\u0000${String(one.handler.at[0]).padStart(10, "0")}`;
    if (!found.has(key)) found.set(key, one);
  };
  for (const entry of analysis.functions.values()) {
    if (file === undefined || entry.file === file) inferred(entry, analysis, add);
  }
  for (const module of analysis.modules) {
    if (file !== undefined && module.file !== file) continue;
    evaluate(
      module.effects,
      {
        file: module.file,
        classes: analysis.classes,
        resultOf: (id) => analysis.results.get(id),
        onCatch: add,
      },
      new Map(),
      collected(),
    );
  }
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, one]) => one);
}
