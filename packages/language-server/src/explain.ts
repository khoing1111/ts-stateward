import { explain } from "@stateward/core/internal";
import type { Config } from "@stateward/core/internal";

/** The `stateward/explain` request's params are not `{ ruleId: string }`. */
export class InvalidExplainParamsError extends Error {
  constructor() {
    super("stateward/explain expects { ruleId: string }");
    this.name = "InvalidExplainParamsError";
  }
}

/**
 * The markdown for the rule id in `params`; null for an id no rule has, or when there is no config
 * (the folder is not set up); a lazy rule's module is loaded for it. It is the text of the installed version, so it works offline.
 */
export async function answerExplain(
  config: Config | undefined,
  params: unknown,
): Promise<string | null> {
  if (typeof params !== "object" || params === null || !("ruleId" in params)) {
    throw new InvalidExplainParamsError();
  }
  const { ruleId } = params;
  if (typeof ruleId !== "string") throw new InvalidExplainParamsError();
  return config === undefined ? null : ((await explain(config, ruleId)) ?? null);
}
