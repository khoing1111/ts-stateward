import { readFileSync } from "node:fs";
import { applyBaseline, compareFindings, readBaseline } from "@stateward/core/internal";
import type { CheckResult, Config, Finding, HiddenFindings } from "@stateward/core/internal";

/** What the editor shows after the baseline is laid over a pass. */
export type BaselinedPass = {
  /** New and baselined findings together, in the order of a plain check. */
  findings: readonly Finding[];
  hidden: readonly HiddenFindings[];
  /** The findings the baseline accepts: shown as hints. */
  baselined: ReadonlySet<Finding>;
  /** Only the new ones, for the counts. */
  fresh: CheckResult;
};

/** The text of `file` as the editor has it: unsaved text first, then the disk. */
function textOf(open: ReadonlyMap<string, string>, file: string): string | undefined {
  const unsaved = open.get(file);
  if (unsaved !== undefined) return unsaved;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Lays the project's baseline (if it has one) over an uncapped `result`. `ran` is the rules the
 * pass ran. Throws `BaselineError` for a baseline file that cannot be used; the caller reports it.
 */
export function layBaseline(
  config: Config,
  result: CheckResult,
  ran: ReadonlySet<string>,
  open: ReadonlyMap<string, string>,
): BaselinedPass {
  const view = applyBaseline(readBaseline(config), result, {
    configDir: config.configDir,
    readText: (file) => textOf(open, file),
    ran,
  });
  return {
    findings: [...view.fresh.findings, ...view.baselined].sort(compareFindings),
    hidden: view.fresh.hidden,
    baselined: new Set(view.baselined),
    fresh: view.fresh,
  };
}
