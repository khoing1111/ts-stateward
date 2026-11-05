import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineRule, option } from "../src/internal.js";
import type { ConfigOptionsOf, NoOptions } from "../src/internal.js";
import { fixturePath, posix } from "./fixture-path.js";

/*
 * What a config may say is checked by the compiler, so these tests compile small config files
 * (fixtures/config-types) and read the compiler's errors: the same errors an editor shows in
 * `stateward.config.ts`. No suppression comments are used; a wrong config is a file that must fail.
 */

function errorsOf(file: string): readonly string[] {
  const fixture = posix(fixturePath(`config-types/${file}`));
  const program = ts.createProgram([fixture], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2023.d.ts"],
    types: [],
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    skipLibCheck: true,
    noEmit: true,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => posix(diagnostic.file?.fileName ?? "") === fixture)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("the types of rules in stateward.config.ts", () => {
  it("accepts rule ids of every plugin, with the options each rule declares", () => {
    expect(errorsOf("valid.ts")).toEqual([]);
  });

  it("rejects a rule id no plugin has", () => {
    expect(errorsOf("bad-rule-id.ts").join("\n")).toContain('"first/sizd"');
  });

  it("rejects the rule of a plugin that is not in plugins", () => {
    expect(errorsOf("bad-rule-of-other-plugin.ts").join("\n")).toContain('"second/plain"');
  });

  it("completes the groups of the plugins and accepts only a severity for one", () => {
    expect(errorsOf("bad-group-id.ts").join("\n")).toContain('"first/sizng"');
    expect(errorsOf("bad-group-of-other-plugin.ts").join("\n")).toContain('"second/g"');
    expect(errorsOf("bad-group-options.ts").join("\n")).toContain("not assignable");
  });

  it("accepts extends, overrides, defaults and ignores, with the same completion", () => {
    expect(errorsOf("valid-scale.ts")).toEqual([]);
  });

  it("completes the rule ids in an override and takes a severity only", () => {
    expect(errorsOf("bad-override-rule-id.ts").join("\n")).toContain('"first/sizd"');
    expect(errorsOf("bad-override-options.ts").join("\n")).toContain("not assignable");
  });

  it("rejects an ignores value that is not one of the options", () => {
    expect(errorsOf("bad-ignores.ts").join("\n")).toContain('"sometimes"');
  });

  it("rejects an option name the rule does not declare", () => {
    expect(errorsOf("bad-option-name.ts").join("\n")).toContain("maxx");
  });

  it("rejects an option value of the wrong type", () => {
    expect(errorsOf("bad-option-type.ts").join("\n")).toContain(
      "Type 'string' is not assignable to type 'number'",
    );
  });

  it("rejects a string that is not one of the option's oneOf", () => {
    expect(errorsOf("bad-option-value.ts").join("\n")).toContain('"c"');
  });

  it("completes the kinds of a severity per kind, takes only severities, and checks unknowns", () => {
    expect(errorsOf("bad-severity-kind.ts").join("\n")).toContain("'maybe'");
    const errors = errorsOf("bad-severity-value.ts").join("\n");
    expect(errors).toContain('"loud"');
    expect(errors).toContain('"error"');
  });

  it("rejects any option on a rule that declares none", () => {
    expect(errorsOf("bad-option-on-rule-without-options.ts").join("\n")).toContain("'never'");
  });
});

describe("ConfigOptionsOf", () => {
  const meta = {
    description: "d",
    defaultSeverity: "warning",
    tier: "core",
    group: "g",
    explain: "e",
  } as const;
  const sized = defineRule({
    kind: "file",
    meta: {
      ...meta,
      options: {
        max: option.number({ default: 3, description: "Most." }),
        mode: option.string({ default: "a", description: "Mode.", oneOf: ["a", "b"] }),
        ignore: option.strings({ default: [], description: "Names." }),
      },
    },
    check() {
      return;
    },
  });
  const plain = defineRule({
    kind: "file",
    meta,
    check() {
      return;
    },
  });

  it("is the declared options, each optional, with their value types", () => {
    expect(Object.keys(sized.meta.options ?? {})).toEqual(["max", "mode", "ignore"]);
    type Sized = ConfigOptionsOf<typeof sized>;
    expectTypeOf<Sized>().toEqualTypeOf<{
      readonly max?: number;
      readonly mode?: "a" | "b";
      readonly ignore?: readonly string[];
    }>();
  });

  it("takes no names for a rule that declares no options", () => {
    expect(plain.meta.options).toBeUndefined();
    type Plain = ConfigOptionsOf<typeof plain>;
    expectTypeOf<Plain>().toEqualTypeOf<NoOptions>();
  });
});
