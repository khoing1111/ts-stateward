import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard, ruleCode } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The plain form, in the context's own names. */
function hintFor(label: string, name: string, type: string): string {
  return [
    "create it with `undefined` and read it in a hook that throws, so a missing Provider fails at once:",
    `    const ${name} = createContext<${type} | undefined>(undefined);`,
    `    // in use${label}(): if (value === undefined) throw new Error("${name} needs a Provider");`,
  ].join("\n");
}

function headline(name: string, argument: string): string {
  const context = name === "this context" ? "context" : `\`${name}\``;
  return `${context} defaults to a fake value, \`${argument}\``;
}

describe("react-context/fake-default-value", () => {
  it("flags {} and casts, however createContext is reached", () => {
    const { findings } = checkFixture(fixture("flagged"), [reactContext()]);
    expect(findings.map((f) => f.message)).toEqual([
      headline("A", "{} as Theme"),
      headline("B", "undefined as unknown as Theme"),
      headline("D", "{} as Theme"),
      headline("E", "null!"),
      headline("F", "{} as Theme"),
      headline("G", "(null!)"),
      headline("H", "{}"),
      headline("I", '{ color: "red" } as Theme'),
      headline("J", '{ color: "red", extra: "somet\u2026'),
      headline("this context", "{} as Theme"),
      headline("L", "null!"),
      headline("M", "null!"),
      headline("O", "{} satisfies Partial<Theme> a\u2026"),
      headline("P", "[] as Item[]"),
      headline("ThemeContext", "{} as Theme"),
      headline("Destructured", "{} as Theme"),
      headline("Renamed", "{} as Theme"),
      headline("Q", "<Theme>{}"),
    ]);
    for (const finding of findings) {
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: "react-context/fake-default-value",
        severity: "info",
      });
      expect(finding.hint).toContain("create it with `undefined` and read it in a hook");
      expect(finding.hint).not.toContain("@stateward");
    }
    // The context's own names when it ends in "Context", a neutral name when it does not.
    expect(findings[0]?.hint).toBe(hintFor("My", "MyContext", "Theme"));
    expect(findings.find((f) => f.message.includes("`ThemeContext`"))?.hint).toBe(
      hintFor("Theme", "ThemeContext", "Theme"),
    );
    expectMessageStandard(findings);
  });

  it("locates the whole call", () => {
    const { findings } = checkFixture(fixture("flagged"), [reactContext()]);
    expect(findings[0]?.location).toEqual({
      file: `${fixture("flagged").split(path.sep).join("/")}/contexts.tsx`,
      start: 155,
      end: 188,
    });
  });

  it("does not flag real defaults, undefined or null (also cast to a type that keeps them), as const, or a user's own createContext", () => {
    const { findings, stats } = checkFixture(fixture("not-flagged"), [reactContext()]);
    expect(findings).toEqual([]);
    expect(stats.files).toBe(2);
  });

  it("allows the one cast of a helper that returns a RequiredContext, and points a stated context made elsewhere at it", () => {
    const { findings } = checkFixture(fixture("guarantees"), [reactContext()]);
    expectMessageStandard(findings);
    expect(findings.map((f) => [path.basename(f.location.file), f.message, f.hint])).toEqual([
      [
        "contexts.ts",
        headline("ThemeContext", "undefined as never"),
        [
          "create it with the helper of the guarantees file, which holds the one cast:",
          "    requiredContext<Theme>()",
        ].join("\n"),
      ],
      [
        "contexts.ts",
        headline("this context", "undefined as never"),
        hintFor("My", "MyContext", "T"),
      ],
    ]);
  });

  it("can be switched off", () => {
    const { findings } = checkFixture(fixture("flagged"), [reactContext()], {
      "react-context/fake-default-value": "off",
    });
    expect(findings).toEqual([]);
  });
});

describe("reactContext", () => {
  it("is a plugin named react-context with its two rules, a hover, a refactoring and its guarantees", () => {
    const plugin = reactContext();
    expect(plugin.name).toBe("react-context");
    expect(Object.keys(plugin.rules)).toEqual(["fake-default-value", "provider-missing"]);
    expect(Object.keys(plugin.editor ?? {})).toEqual(["hover", "codeActions", "guarantees"]);
  });

  it("explains the rule with a bad and a good example", () => {
    const rule = ruleCode(reactContext(), "fake-default-value");
    expect(rule.meta.defaultSeverity).toBe("error");
    expect(rule.meta.explain).toContain("example-bad");
    expect(rule.meta.explain).toContain("example-good");
    expect(rule.meta.explain).not.toContain("createRequiredContext");
  });
});
