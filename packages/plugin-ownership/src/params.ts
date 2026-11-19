import type { ParamSummary } from "./summary.js";

/** Where a function changes a parameter: in which file, and the function that does it. */
export type Witness = { file: string; start: number; end: number; fn: string };

export const keyOf = (id: string, index: number): string => `${id}\u0000${String(index)}`;

/**
 * For each function parameter that the project's functions change, where the change is: its own
 * write, or that of a function it passes the parameter on to, however long the chain (and a
 * cycle ends where it began: a parameter nothing changes has no witness).
 */
export function changedParams(
  summaries: ReadonlyMap<string, { params: readonly ParamSummary[] }>,
): {
  witnesses: Map<string, Witness>;
  /** The parameters that keep their argument where it cannot be followed, and the function. */
  keeps: Map<string, string>;
} {
  const witnesses = new Map<string, Witness>();
  const keeps = new Map<string, string>();
  const pending: { key: string; forwards: readonly { id: string; index: number }[] }[] = [];
  for (const [file, summary] of [...summaries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const param of summary.params) {
      const key = keyOf(param.id, param.index);
      if (param.escapes) keeps.set(key, param.fn);
      if (param.write !== null) witnesses.set(key, { file, fn: param.fn, ...param.write });
      else pending.push({ key, forwards: param.forwards });
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const summary of summaries.values()) {
      for (const param of summary.params) {
        const key = keyOf(param.id, param.index);
        if (keeps.has(key)) continue;
        const next = param.forwards
          .map((forward) => keeps.get(keyOf(forward.id, forward.index)))
          .find((fn) => fn !== undefined);
        if (next !== undefined) {
          keeps.set(key, next);
          changed = true;
        }
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const { key, forwards } of pending) {
      if (witnesses.has(key)) continue;
      const found = forwards
        .map((next) => witnesses.get(keyOf(next.id, next.index)))
        .find((witness) => witness !== undefined);
      if (found !== undefined) {
        witnesses.set(key, found);
        changed = true;
      }
    }
  }
  return { witnesses, keeps };
}
