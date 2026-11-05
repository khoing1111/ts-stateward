export { main } from "./main.js";
export type { CliEnv, ExitCode } from "./main.js";
// The packs `init` offers: a static catalog, so the CLI imports no pack (the generated docs and
// the packs' rules.meta.ts are made from it).
export { PACK_CATALOG, importNameOf } from "./catalog.js";
export type { PackDetection, PackEntry, PackName } from "./catalog.js";
// A config imports from "stateward"; core stays the source of these.
export { defineConfig, defaults } from "@stateward/core/internal";
export type {
  Config,
  Plugin,
  Preset,
  Rule,
  RuleMeta,
  RuleSetting,
  RuleTier,
  Severity,
  UserConfig,
} from "@stateward/core/internal";
export { EXPLAIN_SECTIONS, explainSectionProblems } from "./explain-sections.js";
