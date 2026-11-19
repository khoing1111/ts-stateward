import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture } from "./helpers.js";

/**
 * Feedback from a real project: each fixture reproduces one reported shape. Every quick fix of
 * these compiles (non-exhaustive-switch.test.ts tries them all).
 */

const RULE = "non-exhaustive-switch";

function found(setting?: Parameters<typeof checkOnly>[2]): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/real-a`), RULE, setting);
}

function inFile(findings: readonly Finding[], name: string): Finding[] {
  return findings.filter((finding) => path.basename(finding.location.file) === name);
}

function severities(findings: readonly Finding[]): string[] {
  return findings.map((finding) => (finding.kind === "problem" ? finding.severity : finding.kind));
}

describe("real-a: the shapes a real project has", () => {
  it("reports each `switch` whose `default` handles a case nobody allowed, once", () => {
    expect(
      found().map((finding) => `${path.basename(finding.location.file)}: ${finding.message}`),
    ).toEqual([
      'computed.ts: the `default` of the `switch` on `getAlertMode()` takes "banner" and "sound", which no `case` names',
      'helper.ts: the `default` of the `switch` on `step` takes "done" and "review", which no `case` names',
      'hook.ts: the `default` of the `switch` on `selectedNode.type` takes "image" and "text", which no `case` names',
      'keyword.ts: the `default` of the `switch` on `type` takes "date" and "number", which no `case` names',
      'many.ts: the `default` of the `switch` on `name` takes "blur", "drag", "focus" and 3 more, which no `case` names',
      'many.ts: the `default` of the `switch` on `name` takes "blur", "drag", "focus" and 3 more, which no `case` names',
      'many.ts: the `default` of the `switch` on `name` takes "blur", "drag", "focus", "resize" and "scroll", which no `case` names',
      'nullish.ts: the `default` of the `switch` on `name` takes undefined, null, "blur" and 5 more, which no `case` names',
      'objects.ts: the `default` of the `switch` on `shape.kind` takes "line", which no `case` names',
    ]);
  });

  it("leaves a `case` that shares the `default`'s body alone: every case is listed", () => {
    expect(inFile(found(), "shared.ts")).toEqual([]);
  });

  it("writes the allowance of a value named `type` as `void (type satisfies …)`, which parses as an expression", () => {
    const [keyword] = inFile(found(), "keyword.ts");
    expect(keyword?.hint).toContain('`default: void (type satisfies "date" | "number");`');
  });

  it("reports a `default` above maxHidden as info, the allowance first", () => {
    const many = inFile(found(), "many.ts");
    expect(severities(many)).toEqual(["info", "info", "error"]);
    expect(many[0]?.hint).toBe(
      [
        "one of",
        "- allow them in `default`:",
        '    default: void (name satisfies "blur" | "drag" | "focus" | "move" | "resize" | "scroll");',
        "- or add a `case` for each, with its own code",
      ].join("\n"),
    );
    expect(severities(inFile(found(["error", { maxHidden: 6 }]), "many.ts"))).toEqual([
      "error",
      "error",
      "error",
    ]);
  });

  it("does not check a union declared outside the project, unless projectTypesOnly is false", () => {
    expect(inFile(found(), "library.ts")).toEqual([]);
    expect(
      inFile(found(["error", { projectTypesOnly: false }]), "library.ts").map(
        (finding) => finding.message,
      ),
    ).toEqual([
      'the `default` of the `switch` on `rule` takes "few", "many", "other", "two" and "zero", which no `case` names',
    ]);
  });
});
