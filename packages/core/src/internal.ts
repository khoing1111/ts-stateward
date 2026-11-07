// For stateward's own packages (the CLI, the language server, the editor extension and the
// repository's scripts), not for rule packs: no promise of stability between versions
//. It holds the public API too, so one import is enough.
export * from "./index.js";
export { isMaxMemory, isPreset, MIN_MAX_MEMORY } from "./config.js";
export {
  CONFIG_FILE_NAMES,
  CONFIG_FILE_PATTERN,
  DEFAULT_CONFIG_FILE,
  DEFAULT_PRESET,
  PRESETS,
  RULE_TIERS,
  orList,
} from "./vocabulary.js";
export {
  RuleDeclarationError,
  RuleLoadError,
  RuleNotLoadedError,
  loadAllRules,
  loadRules,
} from "./lazy.js";
export { addonNames, groupIds, ruleIds, ruleIsOn, ruleSetting } from "./severity.js";
export { displayPath, slashed } from "./display-path.js";
export type { PathModule } from "./display-path.js";
export { matchingOverrides } from "./overrides.js";
export { ROLLOUT_FILE, RolloutError, readRollout, rolloutFile, writeRollout } from "./rollout.js";
export {
  BASELINE_FILE,
  BaselineError,
  OUTDATED_BASELINE,
  applyBaseline,
  baselineFile,
  baselineOf,
  fingerprintOf,
  isOutdated,
  mergeBaseline,
  readBaseline,
  sizeOf,
  writeBaseline,
} from "./baseline.js";
export type { Baseline, BaselineEntry, BaselineView, FingerprintContext } from "./baseline.js";
export { advance, buildPlan, describeNotChecked, describeTurnOn, isClean } from "./plan.js";
export type { Advance, Plan, PlanRow } from "./plan.js";
export {
  findConfigFile,
  findConfigUpward,
  loadConfig,
  loadConfigFile,
  reloadsLocalImports,
} from "./config-file.js";
export {
  LOOSE_NULLS_FIX,
  MAX_FINDINGS_PER_RULE_PER_FILE,
  STRICT_NULLS_REMEDY,
  activeRuleIds,
  compareFindings,
  explain,
  limitFindings,
} from "./engine.js";
export type { CheckProgress } from "./engine.js";
export { SLICE_MS } from "./checker.js";
export { describeStatus, guaranteeAt, proveGuarantees } from "./guarantees.js";
export type { GuaranteeProof, GuaranteeStatus } from "./guarantees.js";
export type { LongestStep, SliceOptions, SlicedCheck } from "./checker.js";
export { IGNORE_FIX_TITLE, IGNORE_RULE_ID, ignoreFix } from "./ignores.js";
export { CACHE_FORMAT, emptyCache, parseSnapshot, toSnapshot } from "./cache.js";
export type { CacheSnapshot, ResultCache } from "./cache.js";
export { stronglyConnectedComponents } from "./graph.js";
export { computeImplementationId, configLocalImports, implementationId } from "./implementation.js";
export {
  PACKAGE_CACHE_DEFAULT_MB,
  PACKAGE_CACHE_MARKER,
  cleanPackageCache,
  packageCacheDir,
  packageCacheLimit,
  packageCacheStats,
  statewardVersion,
} from "./package-cache.js";
export type { PackageCacheClean, PackageCacheStats } from "./package-cache.js";
export {
  NothingToCheckError,
  TsconfigError,
  TypeScriptLibMissingError,
  missingDefaultLib,
  toTypeScriptPath,
  tsconfigDirectory,
} from "./backend/typescript6.js";
export { createTimingRecorder } from "./timing.js";
export { cacheEntries, dropLeastRecentlyUsed, limitBytes, markUsed } from "./disk-limits.js";
export {
  CACHE_SUBDIR,
  PROJECT_CACHE_DIR,
  RESULTS_CACHE_DEFAULT_MB,
  cleanResultsCache,
  defaultCacheDir,
  userCacheDir,
  openDiskCache,
  resultsCacheLimit,
  resultsCacheStats,
} from "./disk-cache.js";
export type { DiskCache, ResultsCacheStats } from "./disk-cache.js";
export type { CacheEntry } from "./disk-limits.js";
export type { RuleCost, RunTiming, TimingRecorder } from "./timing.js";
