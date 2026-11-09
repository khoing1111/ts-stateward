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
      'computed.ts: `switch` on `getAlertMode()` does not handle "banner" and "sound"',
      'helper.ts: `switch` on `step` does not handle "done" and "review"',
      'hook.ts: `switch` on `selectedNode.type` does not handle "image" and "text"',
      'keyword.ts: `switch` on `type` does not handle "date" and "number"',
      'many.ts: `switch` on `name` does not handle "blur", "drag", "focus" and 3 more',
      'many.ts: `switch` on `name` does not handle "blur", "drag", "focus" and 3 more',
      'many.ts: `switch` on `name` does not handle "blur", "drag", "focus", "resize" and "scroll"',
      'nullish.ts: `switch` on `name` does not handle undefined, null, "blur" and 5 more',
      'objects.ts: `switch` on `shape.kind` does not handle "line"',
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
    ).toEqual(['`switch` on `rule` does not handle "few", "many", "other", "two" and "zero"']);
  });
});
