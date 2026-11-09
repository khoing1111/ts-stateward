import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core/internal";
import {
  TOKEN_TYPES,
  buildLineIndex,
  encodeTokens,
  offsetAt,
  positionAt,
  rangesIntersect,
  toCodeActions,
  toDiagnostic,
  toDiagnosticSeverity,
  toHiddenDiagnostic,
  toIgnoreAction,
  toRange,
  type FileMapper,
} from "../src/mapping.js";

const text = "ab\ncde\r\n\nfg";
const index = buildLineIndex(text);

describe("positionAt and offsetAt", () => {
  it("converts offsets to line and character, across \\n and \\r\\n", () => {
    expect(positionAt(index, 0)).toEqual({ line: 0, character: 0 });
    expect(positionAt(index, 2)).toEqual({ line: 0, character: 2 });
    expect(positionAt(index, 3)).toEqual({ line: 1, character: 0 });
    expect(positionAt(index, 6)).toEqual({ line: 1, character: 3 });
    expect(positionAt(index, 8)).toEqual({ line: 2, character: 0 });
    expect(positionAt(index, 9)).toEqual({ line: 3, character: 0 });
    expect(positionAt(index, 11)).toEqual({ line: 3, character: 2 });
  });

  it("clamps offsets outside the text", () => {
    expect(positionAt(index, -4)).toEqual({ line: 0, character: 0 });
    expect(positionAt(index, 99)).toEqual({ line: 3, character: 2 });
  });

  it("converts back, clamping to the line and the text", () => {
    expect(offsetAt(index, { line: 1, character: 2 })).toBe(5);
    expect(offsetAt(index, { line: 0, character: 99 })).toBe(2);
    expect(offsetAt(index, { line: 9, character: 0 })).toBe(11);
    expect(offsetAt(index, { line: 3, character: 99 })).toBe(11);
  });

  it("round-trips every offset of a line", () => {
    for (let offset = 0; offset <= text.length; offset++) {
      expect(offsetAt(index, positionAt(index, offset))).toBe(offset);
    }
  });
});

const files: FileMapper = {
  uriOf: (file) => `file://${file}`,
  indexOf: () => index,
  textOf: () => text,
};

const problem: Finding = {
  kind: "problem",
  ruleId: "demo/rule",
  severity: "warning",
  message: "bad",
  hint: "make it good",
  location: { file: "/a.ts", start: 3, end: 6 },
  related: [{ location: { file: "/b.ts", start: 0, end: 2 }, message: "see" }],
  fixes: [
    {
      title: "Fix it",
      edits: [
        { location: { file: "/a.ts", start: 3, end: 4 }, newText: "X" },
        { location: { file: "/b.ts", start: 0, end: 1 }, newText: "Y" },
        { location: { file: "/a.ts", start: 5, end: 6 }, newText: "Z" },
      ],
    },
  ],
};

describe("toDiagnosticSeverity", () => {
  it("maps each severity", () => {
    expect(toDiagnosticSeverity("error")).toBe(DiagnosticSeverity.Error);
    expect(toDiagnosticSeverity("warning")).toBe(DiagnosticSeverity.Warning);
    expect(toDiagnosticSeverity("info")).toBe(DiagnosticSeverity.Information);
  });
});

describe("toDiagnostic", () => {
  it("maps a problem, with the rule id as code and related locations", () => {
    expect(toDiagnostic(problem, files)).toEqual({
      range: toRange(index, problem.location),
      severity: DiagnosticSeverity.Warning,
      code: "demo/rule",
      source: "stateward",
      message: "bad\nFix: make it good",
      relatedInformation: [
        {
          location: {
            uri: "file:///b.ts",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
          },
          message: "see",
        },
      ],
    });
  });

  it("puts each way to fix on its own line, its code example under it (M22)", () => {
    const listed = toDiagnostic(
      {
        ...problem,
        hint: 'one of\n- add `case "x":` with its own code\n- or allow it in `default`:\n    default: void (k satisfies "x");',
      },
      files,
    );
    expect(listed.message).toBe(
      [
        "bad",
        "Fix: one of",
        '  - add `case "x":` with its own code',
        "  - or allow it in `default`:",
        '        default: void (k satisfies "x");',
      ].join("\n"),
    );
  });

  it("shows a baselined finding as a faint hint, whatever its severity, with a prefix", () => {
    const hint = toDiagnostic({ ...problem, severity: "error" }, files, true);
    expect(hint.severity).toBe(DiagnosticSeverity.Hint);
    expect(hint.message).toBe("baselined: bad\nFix: make it good");
    expect(hint.code).toBe("demo/rule");
    const unknown: Finding = {
      kind: "unknown",
      ruleId: "demo/rule",
      message: "cannot tell",
      hint: "declare it",
      location: { file: "/a.ts", start: 0, end: 2 },
    };
    expect(toDiagnostic(unknown, files, true).severity).toBe(DiagnosticSeverity.Hint);
    expect(toDiagnostic(unknown, files).severity).toBe(DiagnosticSeverity.Hint);
    expect(toDiagnostic({ ...unknown, shown: "warning" }, files).severity).toBe(
      DiagnosticSeverity.Warning,
    );
  });

  it("leaves relatedInformation out when there is none", () => {
    const diagnostic = toDiagnostic({ ...problem, related: [] }, files);
    expect("relatedInformation" in diagnostic).toBe(false);
  });

  it("maps a failure to a warning with the same words as a problem", () => {
    const failure: Finding = {
      kind: "failure",
      ruleId: "demo/rule",
      message: "rule demo/rule failed: boom",
      hint: "report this",
      location: { file: "/a.ts", start: 0, end: 2 },
    };
    expect(toDiagnostic(failure, files)).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
      severity: DiagnosticSeverity.Warning,
      code: "demo/rule",
      source: "stateward",
      message: "rule demo/rule failed: boom\nFix: report this",
    });
    expect(toCodeActions(failure, toDiagnostic(failure, files), files)).toEqual([]);
  });

  it("maps a rule's unknown to a faint hint, and stateward's own to an information, with the same words as the terminal", () => {
    const unknown: Finding = {
      kind: "unknown",
      ruleId: "demo/rule",
      message: "no idea",
      hint: "declare the type",
      location: { file: "/a.ts", start: 0, end: 2 },
    };
    expect(toDiagnostic(unknown, files)).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
      severity: DiagnosticSeverity.Hint,
      code: "demo/rule",
      source: "stateward",
      message: "no idea\nFix: declare the type",
    });
    expect(toDiagnostic({ ...unknown, ruleId: "stateward/syntax" }, files).severity).toBe(
      DiagnosticSeverity.Information,
    );
  });
});

describe("toHiddenDiagnostic", () => {
  it("is an information at the start of the file that names the rule and the count", () => {
    expect(toHiddenDiagnostic({ file: "/a.ts", ruleId: "demo/rule", count: 7 })).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      severity: DiagnosticSeverity.Information,
      code: "demo/rule",
      source: "stateward",
      message: "7 more demo/rule findings in this file are not shown",
    });
  });
});

describe("toCodeActions", () => {
  it("makes one quickfix per fix, grouping edits by file", () => {
    const diagnostic = toDiagnostic(problem, files);
    expect(toCodeActions(problem, diagnostic, files)).toEqual([
      {
        title: "Fix it",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            "file:///a.ts": [
              { range: toRange(index, { file: "", start: 3, end: 4 }), newText: "X" },
              { range: toRange(index, { file: "", start: 5, end: 6 }), newText: "Z" },
            ],
            "file:///b.ts": [
              { range: toRange(index, { file: "", start: 0, end: 1 }), newText: "Y" },
            ],
          },
        },
      },
    ]);
  });

  it("offers nothing for an unknown", () => {
    const unknown: Finding = {
      kind: "unknown",
      ruleId: "r",
      message: "m",
      hint: "h",
      location: problem.location,
    };
    expect(toCodeActions(unknown, toDiagnostic(unknown, files), files)).toEqual([]);
  });
});

describe("rangesIntersect", () => {
  const range = (line: number, from: number, to: number) => ({
    start: { line, character: from },
    end: { line, character: to },
  });

  it("is true for overlapping and touching ranges, false otherwise", () => {
    expect(rangesIntersect(range(0, 0, 5), range(0, 3, 8))).toBe(true);
    expect(rangesIntersect(range(0, 0, 5), range(0, 5, 8))).toBe(true);
    expect(rangesIntersect(range(0, 0, 4), range(0, 5, 8))).toBe(false);
    expect(rangesIntersect(range(1, 0, 1), range(0, 0, 9))).toBe(false);
  });
});

describe("encodeTokens", () => {
  it("lists the legend in TokenType order", () => {
    expect(TOKEN_TYPES).toEqual(["class", "function", "variable", "type", "decorator", "keyword"]);
  });

  it("sorts tokens, delta-encodes them and cuts a multi-line token at its first line", () => {
    const encoded = encodeTokens(
      [
        { location: { file: "/a.ts", start: 4, end: 9 }, type: "function" },
        { location: { file: "/a.ts", start: 0, end: 2 }, type: "class" },
        { location: { file: "/a.ts", start: 4, end: 4 }, type: "type" },
        { location: { file: "/a.ts", start: 9, end: 11 }, type: "keyword" },
      ],
      index,
    );
    expect(encoded.data).toEqual([0, 0, 2, 0, 0, 1, 1, 3, 1, 0, 2, 0, 2, 5, 0]);
  });
});

describe("toIgnoreAction", () => {
  const code = "function f() {\n    return words[status];\n}\n";
  const at = (kind: "problem" | "unknown" | "failure", ruleId = "demo/rule"): Finding => {
    const location = {
      file: "/a.ts",
      start: code.indexOf("words"),
      end: code.indexOf("words") + 5,
    };
    return kind === "problem"
      ? {
          kind,
          ruleId,
          severity: "error",
          message: "m",
          hint: "h",
          location,
          related: [],
          fixes: [],
        }
      : { kind, ruleId, message: "m", hint: "h", location };
  };
  const mapper: FileMapper = {
    uriOf: (file) => `file://${file}`,
    indexOf: () => buildLineIndex(code),
    textOf: () => code,
  };

  it("writes the comment on the line above, indented like the finding", () => {
    for (const finding of [at("problem"), at("unknown")]) {
      const action = toIgnoreAction(finding, toDiagnostic(finding, mapper), mapper);
      expect(action?.title).toBe("Add an ignore comment");
      expect(action?.kind).toBe(CodeActionKind.QuickFix);
      expect(action?.edit?.changes).toEqual({
        "file:///a.ts": [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            newText: "    // stateward-ignore demo/rule: \n",
          },
        ],
      });
    }
  });

  it("is not offered for a failure or for a finding about a comment", () => {
    for (const finding of [at("failure"), at("problem", "stateward/ignore")]) {
      expect(toIgnoreAction(finding, toDiagnostic(finding, mapper), mapper)).toBeUndefined();
    }
  });
});
