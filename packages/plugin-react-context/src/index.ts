export { reactContext } from "./plugin.js";
export { ReactContextOptionsError } from "./provider-missing/options.js";
export type { EntryOption, ReactContextOptions } from "./provider-missing/options.js";
/** Named here so the inferred type of `reactContext()` (and of a config that uses it) is portable. */
export type { Summary as RequiredProviderSummary } from "./provider-missing/summary.js";
