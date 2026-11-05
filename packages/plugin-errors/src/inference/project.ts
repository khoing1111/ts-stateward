import type ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { packageResolver } from "./packages.js";
import { summarizeThrows } from "./summarize.js";
import type { ThrowsSummary } from "./summary.js";

/**
 * The last file's summary, by program: `catch-misses-error`, `throws-doc-mismatch` and the React
 * rules all summarize the same facts, and the engine runs a file's rules one after the other.
 * Only the last file is kept: kept for every file, the summaries stayed in memory for the whole
 * run next to the engine's own copies.
 */
const last = new WeakMap<TypeQueries, { sourceFile: ts.SourceFile; summary: ThrowsSummary }>();

/**
 * `summarizeThrows` with the facts of the packages the file calls (packages.ts), computed once
 * per file when its rules run one after the other.
 */
export function summarizeOnce(ctx: FileContext): ThrowsSummary {
  const known = last.get(ctx.types);
  if (known?.sourceFile === ctx.sourceFile) return known.summary;
  const summary = summarizeThrows(ctx, packageResolver(ctx));
  last.set(ctx.types, { sourceFile: ctx.sourceFile, summary });
  return summary;
}
