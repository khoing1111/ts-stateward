// The plugin API: what a rule pack, built in or a team's own, may use. Everything else in core is for stateward's own
// packages and lives in `@stateward/core/internal`; test/public-api.test.ts lists these names, so a change
// here is a deliberate one.
export { defaults, defineConfig, parseConfig } from "./config.js";
export { matchesFile, matchesName, option } from "./options.js";
export type { ConfigOptionsOf, GroupConfigsOf, RuleConfigsOf } from "./options.js";
export { defineRule, definePlugin } from "./define.js";
export { lazyRule, moduleLoader } from "./lazy.js";
export type { ModuleLoader } from "./lazy.js";
// Running a check from code: what the testing helper (`@stateward/core/testing`) is built on.
export { check, createChecker } from "./checker.js";
export type { CheckInput, Checker } from "./checker.js";
// Helpers for project rules that follow calls across files.
export { createPropagationMemo, propagate } from "./graph.js";
export type { Propagation, PropagationMemo } from "./graph.js";
export { highestUncovered, shortestPath } from "./tree.js";
export type { TreeEdge, Uncovered, WalkDown } from "./tree.js";
// The release trait: where a call's result is stated to need releasing (type, marker, facts).
export {
  describeRelease,
  describeTraitSource,
  releaseCandidates,
  releaseTraitOf,
} from "./release.js";
// Facts about packages: the config's and the shipped lines, and the promises they say never reject.
export { neverRejectsFactOf } from "./package-facts.js";
export type { FactContext, PackageFact } from "./package-facts.js";
export type { ReleaseCandidate, ReleaseOptions, ReleaseTrait, ReleaseWay } from "./release.js";
// What a pack learns about a library's code, cached outside the project.
export { packageCodeId } from "./implementation.js";
export { readPackageCache, writePackageCache } from "./package-cache.js";
export type { PackageCacheKey } from "./package-cache.js";
export { findPackageRoot, reparsedWithJsDoc } from "./backend/package-source.js";
export { openPackageSource } from "./backend/typescript6.js";
export type { PackageSource } from "./backend/typescript6.js";
export type {
  BooleanOption,
  CheckNotes,
  CheckResult,
  Config,
  ConfigOverride,
  CoveredNoun,
  CoveredPlace,
  EditorAction,
  EditorContributions,
  EditorHint,
  ExtendedConfig,
  FileContext,
  FactSource,
  FileRule,
  Finding,
  FunctionFacts,
  LibraryTypes,
  LibraryUse,
  MissingTypes,
  PackageFactsConfig,
  Fix,
  FixForm,
  FixReview,
  FixSetReview,
  FixVerdict,
  RejectedFix,
  GroupIdOf,
  HiddenFindings,
  IgnoreOptions,
  IgnoredFinding,
  Json,
  Literal,
  NarrowedMembers,
  SignalParameter,
  StatedGuarantee,
  TraitSource,
  ReleaseFact,
  NoOptions,
  NumberOption,
  OptionSpec,
  RecordOption,
  SeveritiesOption,
  SeverityMap,
  StringListRecord,
  OptionSpecs,
  OptionValue,
  OptionValueOf,
  Options,
  OptionsOf,
  NarrowingTest,
  OverrideOf,
  Location,
  ParseResult,
  Plugin,
  PluginOf,
  PluginsOf,
  Preset,
  ProjectContext,
  ProjectRule,
  RelatedLocation,
  ReportProblem,
  LazyRule,
  PluginRule,
  Rule,
  RuleConfig,
  RuleDeclaration,
  RuleIdOf,
  RuleInfo,
  RuleMeta,
  RuleSelection,
  RuleSetting,
  RuleTier,
  Severity,
  StringOption,
  StringsOption,
  SymbolRef,
  AliasRef,
  TextEdit,
  TokenType,
  TypeQueries,
  UnknownsSetting,
  UserConfig,
} from "./types.js";
