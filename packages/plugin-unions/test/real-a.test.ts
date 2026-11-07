import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { applied, checkOnly, fixture, says, shown, typeErrorsOf } from "./helpers.js";

/**
 * Feedback from a real project: each fixture reproduces one reported shape, and every quick fix must compile.
 */

const SWITCH = "default-hides-cases";
const CHAIN = "if-chain-misses-case";

function switchFindings(setting?: Parameters<typeof checkOnly>[2]): readonly Finding[] {
  return checkOnly(fixture(`${SWITCH}/real-a`), SWITCH, setting);
}

function chainFindings(setting?: Parameters<typeof checkOnly>[2]): readonly Finding[] {
  return checkOnly(fixture(`${CHAIN}/real-a`), CHAIN, setting);
}

function inFile(findings: readonly Finding[], name: string): Finding[] {
  return findings.filter((finding) => path.basename(finding.location.file) === name);
}

function later(subject: string): string {
  return `\`default\` is unreachable: every case of \`${subject}\` is listed`;
}

function hides(count: string, subject: string, labels: string): string {
  const [verb, them] = count === "1" ? ["is", "it"] : ["are", "them"];
  const listed = labels.includes(" more") ? labels : labels.replace(/, (?=[^,]*$)/, " and ");
  return `${listed} of \`${subject}\` ${verb} not listed; \`default\` handles ${them}`;
}

const IGNORE_SWITCH = "    // stateward-ignore unions/default-hides-cases: <why>";

function keep(check: string, statement: string): string {
  return [
    "check the fallback, so a case added later fails to compile:",
    "    default:",
    `      ${check}`,
    `      ${statement}`,
  ].join("\n");
}

/** Function `name` of a text, as lines. */
function functionIn(text: string, name: string): string[] {
  const start = text.indexOf(`export function ${name}(`);
  return text.slice(start, text.indexOf("\n}\n", start) + 2).split("\n");
}

/** The text of a finding's file after its first fix. */
function fixedText(finding: Finding | undefined): string {
  if (finding?.kind !== "problem") throw new Error("expected a problem with a fix");
  const fix = finding.fixes[0];
  if (fix === undefined) throw new Error("expected a fix");
  return applied(readFileSync(finding.location.file, "utf8"), fix.edits);
}

function fixesOf(findings: readonly Finding[]): readonly Finding[] {
  return findings.filter((finding) => finding.kind === "problem" && finding.fixes.length > 0);
}

describe("a tag switch over a union of objects checks the object", () => {
  it("names `node` for intersections and for a member whose tag is a union", () => {
    expect(shown(inFile(switchFindings(), "objects.ts"))).toEqual([
      says("objects.ts", later("node.type"), keep("node satisfies never;", 'return "";')),
      says(
        "objects.ts",
        hides("1", "shape.kind", '"line"'),
        `list the case, then put \`shape satisfies never;\` in the \`default\`; or name it in the \`default\` instead, if that is where it belongs:\n    default: shape.kind satisfies "line";`,
      ),
    ]);
    const [, listed] = inFile(switchFindings(), "objects.ts");
    expect(functionIn(fixedText(listed), "shapeSize").slice(6, 10)).toEqual([
      '    case "line":',
      "      return 0;",
      "    default:",
      "      shape satisfies never;",
    ]);
  });

  it("names `node` in an if-chain too", () => {
    expect(shown(inFile(chainFindings(), "objects.ts"))).toEqual([
      says(
        "objects.ts",
        "`else` is unreachable: every case of `node.type` is tested",
        "put `node satisfies never;` first in the `else`, so a case added later fails to compile",
      ),
    ]);
  });
});

describe("a case that shares the default's body", () => {
  it("gives the case its own copy, then checks the default", () => {
    expect(shown(inFile(switchFindings(), "shared.ts"))).toEqual([
      says(
        "shared.ts",
        later("tone"),
        [
          'give `case "neutral":` its own copy of the body, then check the fallback, so a case added later fails to compile:',
          '    case "neutral":',
          '      return "gray";',
          "    default:",
          "      tone satisfies never;",
        ].join("\n"),
      ),
      says(
        "shared.ts",
        later("tone"),
        [
          'give `case "neutral":` its own copy of the body, then check the fallback, so a case added later fails to compile:',
          '    case "neutral":',
          '      log.push("="); break;',
          "    default:",
          "      tone satisfies never;",
        ].join("\n"),
      ),
      says(
        "shared.ts",
        later("tone"),
        [
          'give `case "neutral":` its own copy of the body, then check the fallback, so a case added later fails to compile:',
          '    case "neutral":',
          '      { const shown = "="; … }',
          "    default:",
          "      tone satisfies never;",
        ].join("\n"),
      ),
    ]);
  });

  it("splits the body: a copy for the case (with a break, or in a block), the check then the body for the default", () => {
    const [returns, runsToEnd, declares] = inFile(switchFindings(), "shared.ts");
    expect(functionIn(fixedText(returns), "toneColor").slice(6, 12)).toEqual([
      '    case "neutral":',
      '      return "gray";',
      "    default:",
      "      tone satisfies never;",
      '      return "gray";',
      "  }",
    ]);
    expect(functionIn(fixedText(runsToEnd), "logTone").slice(8, 15)).toEqual([
      '    case "neutral":',
      '      log.push("=");',
      "      break;",
      "    default:",
      "      tone satisfies never;",
      '      log.push("=");',
      "  }",
    ]);
    expect(functionIn(fixedText(declares), "declares").slice(6, 16)).toEqual([
      '    case "neutral":',
      "      {",
      '        const shown = "=";',
      "        return shown;",
      "      }",
      "    default:",
      "      tone satisfies never;",
      '      const shown = "=";',
      "      return shown;",
      "  }",
    ]);
  });
});

describe("a computed subject", () => {
  it("offers no check that cannot compile: the hint puts the value in a `const` first", () => {
    const found = inFile(switchFindings(), "computed.ts");
    expect(shown(found)).toEqual([
      says(
        "computed.ts",
        later('draft.alertMode ?? "none"'),
        'put the value in a `const` first: `const alertMode = draft.alertMode ?? "none"; switch (alertMode) …`, then check `alertMode` in the `default`',
      ),
      says(
        "computed.ts",
        hides("2", "getAlertMode()", '"banner", "sound"'),
        "put the value in a `const` first: `const alertMode = getAlertMode(); switch (alertMode) …`, then check `alertMode` in the `default`",
      ),
    ]);
    expect(fixesOf(found)).toEqual([]);
  });
});

describe("a subject named `type`", () => {
  it("writes the check as `void (type satisfies never);`, which does not start a type alias", () => {
    expect(shown(inFile(switchFindings(), "keyword.ts"))).toEqual([
      says("keyword.ts", later("type"), keep("void (type satisfies never);", "return 100;")),
      says(
        "keyword.ts",
        hides("2", "type", '"date", "number"'),
        `list the cases, then put \`void (type satisfies never);\` in the \`default\`; or name the 2 cases in the \`default\` if they all mean the same:\n    default: void (type satisfies "date" | "number");`,
      ),
    ]);
    const [, listed] = inFile(switchFindings(), "keyword.ts");
    expect(functionIn(fixedText(listed), "fieldIcon").slice(4, 9)).toEqual([
      '    case "date":',
      '    case "number":',
      '      return "#";',
      "    default:",
      "      void (type satisfies never);",
    ]);
    expect(shown(inFile(chainFindings(), "keyword.ts"))).toEqual([
      says(
        "keyword.ts",
        "`else` is unreachable: every case of `type` is tested",
        "put `void (type satisfies never);` first in the `else`, so a case added later fails to compile",
      ),
    ]);
  });

  it("accepts `(type) satisfies never;` and `void (type satisfies never);` as checks", () => {
    const quiet = checkOnly(fixture(`${SWITCH}/not-flagged`), SWITCH);
    expect(inFile(quiet, "checks.ts")).toEqual([]);
  });
});

describe("inside a hook callback", () => {
  it("switches on a `const` of the tag, so the hook's dependencies stay `selectedNode.type`", () => {
    expect(shown(inFile(switchFindings(), "hook.ts"))).toEqual([
      says(
        "hook.ts",
        later("selectedNode.type"),
        [
          "check a `const` of the tag in the fallback, so a case added later fails to compile and the hook's dependencies stay the same:",
          "    const nodeType = selectedNode.type;",
          "    switch (nodeType) {",
          "    default:",
          "      nodeType satisfies never;",
        ].join("\n"),
      ),
      says(
        "hook.ts",
        hides("2", "selectedNode.type", '"image", "text"'),
        `list the cases, then check a \`const\` of the tag in the \`default\`; or name the 2 cases in the \`default\` if they all mean the same:\n    default: selectedNode.type satisfies "image" | "text";`,
      ),
      says(
        "hook.ts",
        later("selectedNode.type"),
        keep("selectedNode satisfies never;", 'return "";'),
      ),
    ]);
    const [complete, listed] = inFile(switchFindings(), "hook.ts");
    expect(complete).toMatchObject({
      fixes: [
        {
          title:
            "Put `selectedNode.type` in `const nodeType` and add `nodeType satisfies never;` to the default",
          safe: true,
        },
      ],
    });
    expect(functionIn(fixedText(complete), "usePanelTitle").slice(1, 5)).toEqual([
      "  return useMemo(() => {",
      "    const nodeType = selectedNode.type;",
      "    switch (nodeType) {",
      '      case "frame":',
    ]);
    expect(functionIn(fixedText(listed), "usePanelIcon").slice(2, 13)).toEqual([
      "    const nodeType = selectedNode.type;",
      "    switch (nodeType) {",
      '      case "frame":',
      '        return "F";',
      '      case "image":',
      '      case "text":',
      '        return "?";',
      "      default:",
      "        nodeType satisfies never;",
      '        return "?";',
      "    }",
    ]);
  });

  it("tests a `const` of the tag in an if-chain the same way", () => {
    const found = inFile(chainFindings(), "hook.ts");
    expect(shown(found)).toEqual([
      says(
        "hook.ts",
        "`else` is unreachable: every case of `selectedNode.type` is tested",
        "test `const nodeType = selectedNode.type` instead, and put `nodeType satisfies never;` first in the `else`, so a case added later fails to compile",
      ),
      says(
        "hook.ts",
        '"image" of `selectedNode.type` is not tested; `else` handles it',
        `add \`else if\` branches, then check a \`const\` of the tag in the \`else\`; or name it in the \`else\` instead, if that is where it belongs:\n    else { selectedNode.type satisfies "image"; }`,
      ),
    ]);
    expect(functionIn(fixedText(found[0]), "usePanelTitle").slice(2, 6)).toEqual([
      "    const nodeType = selectedNode.type;",
      '    if (nodeType === "frame") {',
      '      return "Frame";',
      '    } else if (nodeType === "text" || nodeType === "image") {',
    ]);
  });
});

describe("a default that may mean everything else", () => {
  it("says how to keep it (an ignore comment with the reason); above maxHidden that comes first, as info", () => {
    const found = inFile(switchFindings(), "many.ts");
    const many = `name the 6 cases in the \`default\` if they all mean the same; otherwise list the cases, then put \`name satisfies never;\` in the \`default\`:\n    default: name satisfies "blur" | "drag" | "focus" | "move" | "resize" | "scroll";`;
    // above maxHidden the first 3 are named, `undefined` and `null` first.
    const first = '"blur", "drag", "focus" and 3 more';
    expect(shown(found)).toEqual([
      says("many.ts", hides("6", "name", first), many),
      says("many.ts", hides("6", "name", first), many),
      says(
        "many.ts",
        hides("5", "name", '"blur", "drag", "focus", "resize", "scroll"'),
        `list the cases, then put \`name satisfies never;\` in the \`default\`; or name the 5 cases in the \`default\` if they all mean the same:\n    default: name satisfies "blur" | "drag" | "focus" | "resize" | "scroll";`,
      ),
    ]);
    expect(found.map((finding) => (finding.kind === "problem" ? finding.severity : ""))).toEqual([
      "info",
      "info",
      "error",
    ]);
    expect(shown(inFile(switchFindings(), "nullish.ts"))).toEqual([
      says(
        "nullish.ts",
        hides("8", "name", 'undefined, null, "blur" and 5 more'),
        // Too many cases to spell in one line: the ignore comment stays the example.
        `say why above the \`default\` if the 8 cases all mean the same; otherwise list the cases, then put \`name satisfies never;\` in the \`default\`:\n${IGNORE_SWITCH}`,
      ),
    ]);
  });

  it("takes maxHidden from the config", () => {
    const found = inFile(switchFindings(["error", { maxHidden: 6 }]), "many.ts");
    expect(found.map((finding) => (finding.kind === "problem" ? finding.severity : ""))).toEqual([
      "error",
      "error",
      "error",
    ]);
  });

  it("reports an if-chain's else above maxHidden as info", () => {
    const found = inFile(chainFindings(["error", { report: "all" }]), "many.ts");
    expect(shown(found)).toEqual([
      says(
        "many.ts",
        '"blur", "drag", "focus" and 3 more of `name` are not tested; `else` handles them',
        `name the 6 cases in the \`else\` if they all mean the same; otherwise add \`else if\` branches, then end with \`else { name satisfies never; }\`:\n    else { name satisfies "blur" | "drag" | "focus" | "move" | "resize" | "scroll"; }`,
      ),
    ]);
    expect(found[0]).toMatchObject({ severity: "info" });
  });
});

describe("the project's own never helper comes first", () => {
  it("ends a listed default with the helper, and keeps `satisfies never` where the fallback stays", () => {
    const [complete, listed] = inFile(switchFindings(), "helper.ts");
    expect(shown([complete].flatMap((f) => (f === undefined ? [] : [f])))).toEqual([
      says("helper.ts", later("step"), keep("step satisfies never;", "return -1;")),
    ]);
    expect(functionIn(fixedText(listed), "stepName").slice(4, 9)).toEqual([
      '    case "done":',
      '    case "review":',
      '      return "Other";',
      "    default:",
      "      return ensureNever(step);",
    ]);
  });

  it("names the helper, not a stateward package, in an if-chain's hint and fix", () => {
    const found = inFile(chainFindings(), "helper.ts");
    expect(shown(found)).toEqual([
      says(
        "helper.ts",
        '"done" of `step` is not tested; `else` handles it',
        `add \`else if\` branches, then end with \`else { ensureNever(step); }\`; or name it in the \`else\` instead, if that is where it belongs:\n    else { step satisfies "done"; }`,
      ),
      says(
        "helper.ts",
        '`if` chain does not handle "done" of `step`',
        "add `else if` branches for it, then end with `else { ensureNever(step); }`",
      ),
    ]);
    expect(functionIn(fixedText(found[0]), "stepName").slice(5, 10)).toEqual([
      '  } else if (step === "done") {',
      '    return "Other";',
      "  } else {",
      "    return ensureNever(step);",
      "  }",
    ]);
  });
});

describe("unions declared outside the project", () => {
  it("are not checked by default, and are with projectTypesOnly: false", () => {
    expect(inFile(switchFindings(), "library.ts")).toEqual([]);
    expect(inFile(chainFindings(["error", { report: "all" }]), "library.ts")).toEqual([]);
    expect(
      shown(inFile(switchFindings(["error", { projectTypesOnly: false }]), "library.ts")).map(
        (finding) => finding.message,
      ),
    ).toEqual([hides("5", "rule", '"few", "many", "other", "two", "zero"')]);
    expect(
      shown(
        inFile(chainFindings(["error", { report: "all", projectTypesOnly: false }]), "library.ts"),
      ).map((finding) => finding.message),
    ).toEqual(['"few", "many", "other" and "zero" of `rule` are not tested; `else` handles them']);
  });
});

describe("every quick fix compiles", { timeout: 60_000 }, () => {
  const all = [
    ...switchFindings(["error", { projectTypesOnly: false }]),
    ...chainFindings(["error", { report: "all", projectTypesOnly: false }]),
  ];
  const texts = fixesOf(all).map((finding) => ({
    name: `${path.basename(finding.location.file)}:${String(finding.location.start)}`,
    original: readFileSync(finding.location.file, "utf8"),
    fixed: fixedText(finding),
  }));
  let errors: ReadonlyMap<string, string> = new Map();
  beforeAll(() => {
    errors = typeErrorsOf(texts.flatMap((text) => [text.original, text.fixed]));
  });

  it("has a fix for each form", () => {
    expect(texts.length).toBeGreaterThanOrEqual(20);
  });

  it.each(texts.map((text) => [text.name, text] as const))("%s", (_, text) => {
    expect(errors.get(text.original)).toBe("");
    expect(errors.get(text.fixed)).toBe("");
  });
});

describe("other forms of a fix, best first, for core to try", () => {
  const titles = (finding: Finding | undefined): string[] =>
    finding?.kind === "problem"
      ? finding.fixes.flatMap((fix) => [
          fix.title,
          ...(fix.alternatives ?? []).map((form) => form.title),
        ])
      : [];

  it("in a hook: the tag's const, then the object, then the tag itself", () => {
    const [complete] = inFile(switchFindings(), "hook.ts");
    expect(titles(complete)).toEqual([
      "Put `selectedNode.type` in `const nodeType` and add `nodeType satisfies never;` to the default",
      "Add `selectedNode satisfies never;` to the default",
      "Add `selectedNode.type satisfies never;` to the default",
    ]);
  });

  it("the project's helper, then `satisfies never`, for each check", () => {
    const [, listed] = inFile(switchFindings(), "helper.ts");
    expect(listed?.kind === "problem" ? listed.fixes[0]?.alternatives?.length : -1).toBe(1);
    const forms = listed?.kind === "problem" ? (listed.fixes[0]?.alternatives ?? []) : [];
    const text = readFileSync(listed?.location.file ?? "", "utf8");
    expect(functionIn(applied(text, forms[0]?.edits ?? []), "stepName").slice(7, 10)).toEqual([
      "    default:",
      "      step satisfies never;",
      '      return "Other";',
    ]);
  });
});
