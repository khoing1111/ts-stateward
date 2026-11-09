import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as publicApi from "../src/index.js";

/*
 * The plugin API (`@stateward/core`) is a promise to every rule pack, a team's own included
 *. These lists make a change to it deliberate: adding or
 * removing a name here is a decision, and removing one is a major version.
 */

const VALUES = [
  "check",
  "createChecker",
  "createPropagationMemo",
  "defaults",
  "defineConfig",
  "definePlugin",
  "defineRule",
  "describeRelease",
  "describeTraitSource",
  "findPackageRoot",
  "highestUncovered",
  "lazyRule",
  "matchesFile",
  "matchesName",
  "moduleLoader",
  "neverRejectsFactOf",
  "openPackageSource",
  "option",
  "packageCodeId",
  "parseConfig",
  "propagate",
  "readPackageCache",
  "releaseCandidates",
  "releaseTraitOf",
  "reparsedWithJsDoc",
  "shortestPath",
  "writePackageCache",
];

/** The names `export type { … }` lists in index.ts, read from its syntax. */
function typeExports(): string[] {
  const file = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  return source.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.isTypeOnly &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : [],
  );
}

describe("the public API of @stateward/core", () => {
  it("exports exactly these values", () => {
    expect(Object.keys(publicApi).sort()).toEqual(VALUES);
  });

  it("exports exactly these types", () => {
    expect(typeExports().sort()).toMatchInlineSnapshot(`
      [
        "AliasRef",
        "BooleanOption",
        "CheckInput",
        "CheckNotes",
        "CheckResult",
        "Checker",
        "Config",
        "ConfigOptionsOf",
        "ConfigOverride",
        "CoveredNoun",
        "CoveredPlace",
        "EditorAction",
        "EditorContributions",
        "EditorHint",
        "ExtendedConfig",
        "FactContext",
        "FactSource",
        "FileContext",
        "FileRule",
        "Finding",
        "Fix",
        "FixForm",
        "FixReview",
        "FixSetReview",
        "FixVerdict",
        "FunctionFacts",
        "GroupConfigsOf",
        "GroupIdOf",
        "HiddenFindings",
        "IgnoreOptions",
        "IgnoredFinding",
        "Json",
        "LazyRule",
        "LibraryTypes",
        "LibraryUse",
        "Literal",
        "Location",
        "MissingTypes",
        "ModuleLoader",
        "NarrowedMembers",
        "NarrowingTest",
        "NoOptions",
        "NumberOption",
        "OptionSpec",
        "OptionSpecs",
        "OptionValue",
        "OptionValueOf",
        "Options",
        "OptionsOf",
        "OverrideOf",
        "PackageCacheKey",
        "PackageFact",
        "PackageFactsConfig",
        "PackageSource",
        "ParseResult",
        "Plugin",
        "PluginOf",
        "PluginRule",
        "PluginsOf",
        "Preset",
        "ProjectContext",
        "ProjectRule",
        "Propagation",
        "PropagationMemo",
        "RecordOption",
        "RejectedFix",
        "RelatedLocation",
        "ReleaseCandidate",
        "ReleaseFact",
        "ReleaseOptions",
        "ReleaseTrait",
        "ReleaseWay",
        "ReportProblem",
        "Rule",
        "RuleConfig",
        "RuleConfigsOf",
        "RuleDeclaration",
        "RuleIdOf",
        "RuleInfo",
        "RuleMeta",
        "RuleSelection",
        "RuleSetting",
        "RuleTier",
        "SeveritiesOption",
        "Severity",
        "SeverityMap",
        "SignalParameter",
        "StatedGuarantee",
        "StringListRecord",
        "StringOption",
        "StringsOption",
        "SymbolRef",
        "TextEdit",
        "TokenType",
        "TraitSource",
        "TreeEdge",
        "TypeQueries",
        "Uncovered",
        "UnknownsSetting",
        "UserConfig",
        "WalkDown",
      ]
    `);
  });
});
