import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "@stateward/core";
import { checkOnly, fixture, says, shown, type Shown } from "./helpers.js";

const RULE = "if-chain-misses-case";

/** Today's fixtures cover every chain that leaves a case out: they run with `report: "all"`. */
const ALL = ["error", { report: "all" }] as const;

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE, ALL);
}

function inFile(name: string): Finding[] {
  return flagged().filter((finding) => finding.location.file.endsWith(name));
}

function lacks(count: string, subject: string, labels: string): string {
  const noun = count === "1" ? "case" : "cases";
  return `this chain does not handle ${count} ${noun} of \`${subject}\`: ${labels}`;
}

/** How the hint ends a chain: the file's own `never` helper, else `satisfies never`. */
function endWith(target: string, helper?: string): string {
  if (helper !== undefined) return `\`else { ${helper}(${target}); }\``;
  return `\`else { ${target} satisfies never; }\``;
}

function addBranches(who: "it" | "them", target: string, helper?: string): string {
  return `add \`else if\` branches for ${who}, then end with ${endWith(target, helper)}`;
}

function hides(count: string, subject: string, labels: string): string {
  const noun = count === "1" ? "case" : "cases";
  return `this \`else\` hides ${count} ${noun} of \`${subject}\`: ${labels}`;
}

/**
 * The hint of an `else` that hides cases: test them and end with a check on `target`, or say in an
 * ignore comment that the `else` is right for them. Whether a quick fix is offered is core's call.
 */
function addFor(count: number, target: string, rest?: string, many = false): string {
  const n = String(count);
  const list = `add \`else if\` branches, then end with \`else { ${target} satisfies never; }\``;
  // With `rest`, the example says which cases fall through; without it, an ignore comment does.
  const same =
    rest === undefined
      ? count === 1
        ? "if the `else` is right for it, say so above the `else`"
        : `if these ${n} cases all mean the same, say so above the \`else\``
      : count === 1
        ? "if the `else` is right for it, say so"
        : `if these ${n} cases all mean the same, say which`;
  return [
    many ? `${same}, or ${list}:` : `${list}, or ${same}:`,
    rest === undefined
      ? "    // stateward-ignore unions/if-chain-misses-case: <why>"
      : `    else { ${rest} }`,
  ].join("\n");
}

function later(subject: string): string {
  return `this \`else\` will hide any case added to \`${subject}\` later`;
}

function prove(target: string): string {
  return `let TypeScript check it: put \`${target} satisfies never;\` first in the \`else\``;
}

/** Applies the edits of a fix to the text, last first so earlier offsets stay valid. */
function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

function fixedLines(finding: Finding | undefined, file: string): string[] {
  expect(finding?.kind).toBe("problem");
  if (finding?.kind !== "problem") return [];
  expect(finding.fixes).toHaveLength(1);
  return applied(readFileSync(file, "utf8"), finding.fixes[0]?.edits ?? []).split("\n");
}

function aroundProof(lines: readonly string[]): string[] {
  const at = lines.findIndex((line) => line.includes("satisfies never"));
  return lines.slice(at - 1, at + 2);
}

describe(`unions/${RULE}: a chain that does not handle every case`, () => {
  it("lists the missing cases, sorted, for discriminants, plain unions and optional chains", () => {
    expect(shown(inFile("missing.ts"))).toEqual([
      says(
        "missing.ts",
        lacks("2", "status.kind", '"failed", "retry"'),
        addBranches("them", "status"),
      ),
      says("missing.ts", lacks("1", "status.kind", '"retry"'), addBranches("it", "status")),
      says("missing.ts", lacks("1", "mode", '"rw"'), addBranches("it", "mode")),
      says(
        "missing.ts",
        lacks("2", "status . kind", '"failed", "retry"'),
        addBranches("them", "status"),
      ),
      says(
        "missing.ts",
        lacks("2", "status.kind", '"failed", "retry"'),
        addBranches("them", "status"),
      ),
    ]);
  });

  it("reads `in`, `typeof`, `instanceof`, user type guards and `||` on one reference", () => {
    expect(shown(inFile("forms.ts"))).toEqual([
      says(
        "forms.ts",
        lacks("1", "shape", "{ width: number; height: number; }"),
        addBranches("it", "shape"),
      ),
      says("forms.ts", lacks("1", "value", "boolean"), addBranches("it", "value")),
      says("forms.ts", lacks("1", "value", "number"), addBranches("it", "value")),
      says("forms.ts", lacks("1", "pet", "Bird"), addBranches("it", "pet")),
      says("forms.ts", lacks("1", "figure", "Triangle"), addBranches("it", "figure")),
      says("forms.ts", lacks("1", "figure.shape", '"triangle"'), addBranches("it", "figure")),
      says("forms.ts", lacks("1", "figure", "Triangle"), addBranches("it", "figure")),
    ]);
  });

  it("labels enum members as the developer writes them, and skips a value that is not a member", () => {
    expect(shown(inFile("enums.ts"))).toEqual([
      says("enums.ts", lacks("1", "color", "Color.Blue"), addBranches("it", "color")),
    ]);
  });

  it("widens a type parameter to its constraint", () => {
    expect(shown(inFile("generic.ts"))).toEqual([
      says("generic.ts", lacks("1", "t.kind", '"c"'), addBranches("it", "t")),
      says("generic.ts", hides("1", "x", '"c"'), addFor(1, "x", 'x satisfies "c";')),
    ]);
  });

  it("reports on the `if` that starts the chain, as an error, with no quick fix", () => {
    const [first] = inFile("missing.ts");
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: `unions/${RULE}`,
      severity: "error",
      related: [],
      fixes: [],
    });
    const text = readFileSync(fixture(`${RULE}/flagged/missing.ts`), "utf8");
    expect(text.slice(first?.location.start, first?.location.end)).toBe("if");
  });
});

describe(`unions/${RULE}: an else that hides cases`, () => {
  it("names the hidden cases, sorted, and says what to add", () => {
    expect(shown(inFile("hides.ts"))).toEqual([
      says(
        "hides.ts",
        hides("2", "status.kind", '"failed", "retry"'),
        addFor(2, "status", 'status.kind satisfies "failed" | "retry";'),
      ),
      says(
        "hides.ts",
        hides("1", "status.kind", '"retry"'),
        addFor(1, "status", 'status.kind satisfies "retry";'),
      ),
      says("hides.ts", hides("1", "value", "boolean"), addFor(1, "value")),
      says(
        "hides.ts",
        hides("1", "status.kind", '"retry"'),
        addFor(1, "status", 'status.kind satisfies "retry";'),
      ),
      says(
        "hides.ts",
        hides("5", "shape", '"box", "diamond", "ellipse", "frame", "image"'),
        addFor(5, "shape", 'shape satisfies "box" | "diamond" | "ellipse" | "frame" | "image";'),
      ),
    ]);
  });

  it("reports on the `else` keyword, with a quick fix that lists the hidden cases, not for --fix", () => {
    const [first] = inFile("hides.ts");
    expect(first).toMatchObject({
      kind: "problem",
      fixes: [
        { title: "List the 2 hidden cases (same behaviour)" },
        { title: 'Add `status.kind satisfies "failed" | "retry";` to the else', safe: false },
      ],
    });
    const text = readFileSync(fixture(`${RULE}/flagged/hides.ts`), "utf8");
    expect(text.slice(first?.location.start, first?.location.end)).toBe("else");
  });
});

describe(`unions/${RULE}: every case handled, the else has no proof`, () => {
  it("says the else will hide a case added later, and what to prove it on", () => {
    expect(shown(inFile("complete.ts"))).toEqual([
      says("complete.ts", later("status.kind"), prove("status")),
      says("complete.ts", later("status.kind"), prove("status")),
      says("complete.ts", later("mode"), prove("mode")),
      says("complete.ts", later("mode"), prove("mode")),
      says("complete.ts", later("mode"), prove("mode")),
      says("complete.ts", later("mode"), prove("mode")),
      says("complete.ts", later("value"), prove("value")),
      says("complete.ts", later("pet"), prove("pet")),
      says("complete.ts", later("shape"), prove("shape")),
      says("complete.ts", later("job.kind"), prove("job.kind")),
      says("complete.ts", later("figure"), prove("figure")),
      says("complete.ts", later("t.shape"), prove("t")),
      says("complete.ts", later("x"), prove("x")),
      says("complete.ts", later("figure.shape"), prove("figure")),
    ]);
  });

  it("fixes an else whose first statement is on its own line, at that indentation", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[0], file))).toEqual([
      "  } else {",
      "    status satisfies never;",
      "    return -1;",
    ]);
    const lines = fixedLines(inFile("complete.ts")[0], file);
    expect(lines).toHaveLength(readFileSync(file, "utf8").split("\n").length + 1);
  });

  it("fixes an else whose statement shares the line, one level in from the else", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[1], file))).toEqual([
      "  } else {",
      "    status satisfies never;",
      "    return -1; }",
    ]);
  });

  it("keeps tab indentation", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[3], file))).toEqual([
      "\t} else {",
      "\t\tmode satisfies never;",
      "\t\treturn -1;",
    ]);
  });

  it("offers no fix for an empty else or one that is not a block", () => {
    const found = inFile("complete.ts");
    expect(found[4]).toMatchObject({ kind: "problem", fixes: [] });
    expect(found[5]).toMatchObject({ kind: "problem", fixes: [] });
  });

  it("titles the fix with the statement it adds", () => {
    expect(inFile("complete.ts")[0]).toMatchObject({
      fixes: [{ title: "Add `status satisfies never;` to the else" }],
    });
  });

  it("reports on the `else` keyword", () => {
    const [first] = inFile("complete.ts");
    const text = readFileSync(fixture(`${RULE}/flagged/complete.ts`), "utf8");
    expect(text.slice(first?.location.start, first?.location.end)).toBe("else");
  });
});

describe(`unions/${RULE}: the file already imports assertNever`, () => {
  it("does not say where assertNever comes from", () => {
    expect(shown(inFile("imported.ts"))).toEqual([
      says("imported.ts", lacks("1", "mode", '"x"'), addBranches("it", "mode", "assertNever")),
    ]);
  });
});

describe(`unions/${RULE}: headlines stay short`, () => {
  it("never cuts a subject or a label; enum members go by their own name when that is what makes the list fit", () => {
    expect(shown(inFile("long-names.ts"))).toEqual([
      says(
        "long-names.ts",
        'this chain does not handle 2 cases of `thisIsAVeryLongVariableNameForTheUploadStatusObject.stage`: "initialisingTheConnection", "uploadingTheFirstChunk"',
        "add `else if` branches for them, then end with `else { thisIsAVeryLongVariableNameForTheUploadStatusObject satisfies never; }`",
      ),
      says(
        "long-names.ts",
        later("thisIsAVeryLongVariableNameForTheUploadStatusObject.stage"),
        prove("thisIsAVeryLongVariableNameForTheUploadStatusObject"),
      ),
      says(
        "long-names.ts",
        lacks("5", "word", '"bravo", "charlie", "delta", "echo", "foxtrot"'),
        addBranches("them", "word"),
      ),
      says(
        "long-names.ts",
        "this chain does not handle 2 cases of `selectedStorageType`: DATABASE, STORAGE_TYPE_UNSPECIFIED",
        "add `else if` branches for them, then end with `else { selectedStorageType satisfies never; }`",
      ),
    ]);
  });

  it("keeps the words of a headline within 100 characters and of a fix line within 140", () => {
    for (const finding of flagged()) {
      // Only quoted names may push a line past its limit; expectMessageStandard holds the example.
      expect(finding.message.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(100);
      expect(finding.hint.split("\n")[0]?.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(140);
      expect(finding.message).not.toContain("…");
    }
  });
});

/** The fixed text must compile: checked with the tsc binary, not the checker API. */
function typeErrors(text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "stateward-fixed-"));
  try {
    writeFileSync(path.join(dir, "a.ts"), text);
    writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          types: [],
        },
        files: ["a.ts"],
      }),
    );
    const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
    const result = spawnSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8" });
    return result.status === 0 ? "" : result.stdout + result.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe(`unions/${RULE}: the quick fix compiles`, { timeout: 60_000 }, () => {
  it("compiles with every fix of complete.ts applied at once", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    const original = readFileSync(file, "utf8");
    const edits = inFile("complete.ts").flatMap((finding) =>
      finding.kind === "problem" ? finding.fixes.flatMap((fix) => fix.edits) : [],
    );
    // All but the empty else and the bare `else return`.
    expect(edits).toHaveLength(12);
    expect(typeErrors(original)).toBe("");
    const fixed = applied(original, edits);
    expect(fixed.match(/satisfies never;/g)).toHaveLength(12);
    expect(typeErrors(fixed)).toBe("");
  });

  it("compiles the chains the hints ask for, so none is a trap", () => {
    const text = readFileSync(fixture(`${RULE}/not-flagged/compiles.ts`), "utf8");
    expect(typeErrors(text)).toBe("");
  });
});

describe(`unions/${RULE}: by default, only chains meant to handle every case`, () => {
  const likely = (setting?: typeof ALL): Shown[] =>
    shown(checkOnly(fixture(`${RULE}/likely`), RULE, setting));

  it("reports a complete chain without a proof, an else hiding up to 2 cases, and a chain missing 1", () => {
    expect(likely()).toEqual([
      says("chains.ts", later("mode"), prove("mode")),
      says(
        "chains.ts",
        hides("2", "phase", '"approved", "published"'),
        addFor(2, "phase", 'phase satisfies "approved" | "published";'),
      ),
      says("chains.ts", lacks("1", "phase", '"approved"'), addBranches("it", "phase")),
    ]);
  });

  it("reports a chain that leaves a case out as a warning (a guess), and a missing proof as an error", () => {
    const severities = (setting: typeof ALL | "error"): [string, string][] =>
      checkOnly(fixture(`${RULE}/likely`), RULE, setting).map((finding) => [
        finding.kind === "problem" ? (finding.findingKind ?? "") : finding.kind,
        finding.kind === "problem" ? finding.severity : "",
      ]);
    expect(severities("error")).toEqual([
      ["complete", "error"],
      ["hidden", "warning"],
      ["missing", "warning"],
    ]);
    expect(severities(ALL)).toEqual([
      ["complete", "error"],
      ["hidden", "error"],
      ["hidden", "error"],
      ["missing", "error"],
      ["missing", "error"],
    ]);
  });

  it('reports every chain that leaves a case out with report: "all"', () => {
    expect(likely(ALL)).toEqual([
      says("chains.ts", later("mode"), prove("mode")),
      says(
        "chains.ts",
        hides("2", "phase", '"approved", "published"'),
        addFor(2, "phase", 'phase satisfies "approved" | "published";'),
      ),
      says(
        "chains.ts",
        hides("3", "phase", '"approved", "archived", "published"'),
        addFor(3, "phase", 'phase satisfies "approved" | "archived" | "published";'),
      ),
      says("chains.ts", lacks("1", "phase", '"approved"'), addBranches("it", "phase")),
      says(
        "chains.ts",
        lacks("2", "phase", '"approved", "published"'),
        addBranches("them", "phase"),
      ),
    ]);
  });
});

describe(`unions/${RULE}: not flagged`, () => {
  it("accepts guard clauses, mixed references, complete chains, proofs and tests it does not read", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });

  it("accepts each file on its own", () => {
    for (const name of ["ok.ts", "optional.ts", "narrowing.ts", "compiles.ts"]) {
      const found = checkOnly(fixture(`${RULE}/not-flagged`), RULE).filter((f) =>
        f.location.file.endsWith(name),
      );
      expect(shown(found)).toEqual([]);
    }
  });
});

describe(`unions/${RULE}: a type that does not name the cases that fall through`, () => {
  it("keeps the finding, and writes the exact type in the example", () => {
    expect(shown(inFile("rest-mismatch.ts"))).toEqual([
      says(
        "rest-mismatch.ts",
        hides("2", "mode", '"x", "y"'),
        addFor(2, "mode", 'mode satisfies "x" | "y";'),
      ),
    ]);
  });

  it("offers the inline check as a second quick fix that keeps the else's body", () => {
    const finding = inFile("rest-mismatch.ts")[0];
    expect(finding).toMatchObject({
      fixes: [
        { title: "List the 2 hidden cases (same behaviour)" },
        { title: 'Add `mode satisfies "x" | "y";` to the else', safe: false },
      ],
    });
    const file = fixture(`${RULE}/flagged/rest-mismatch.ts`);
    const original = readFileSync(file, "utf8");
    const fixed = applied(
      original,
      finding?.kind === "problem" ? (finding.fixes[1]?.edits ?? []) : [],
    ).split("\n");
    const at = fixed.findIndex((line) => line.includes("satisfies"));
    expect(fixed.slice(at - 1, at + 2)).toEqual([
      "  } else {",
      '    mode satisfies "x" | "y";',
      '    mode satisfies "r" | "x" | "y";',
    ]);
  });
});

describe(`unions/${RULE}: the quick fix that lists the hidden cases`, { timeout: 60_000 }, () => {
  const file = fixture(`${RULE}/fixes/fixes.ts`);
  const original = readFileSync(file, "utf8");
  const found = checkOnly(fixture(`${RULE}/fixes`), RULE);

  /** The finding inside function `name`. */
  function findingIn(name: string): Finding | undefined {
    const start = original.indexOf(`export function ${name}(`);
    const end = original.indexOf("\n}\n", start);
    return found.find((f) => f.location.start > start && f.location.start < end);
  }

  /** The text after the fix of the finding in function `name`. */
  function fixedText(name: string): string {
    const finding = findingIn(name);
    if (finding?.kind !== "problem") return original;
    return applied(original, finding.fixes[0]?.edits ?? []);
  }

  /** Function `name` after its fix, as lines. */
  function fixedFunction(name: string): string[] {
    const fixed = fixedText(name);
    const start = fixed.indexOf(`export function ${name}(`);
    return fixed.slice(start, fixed.indexOf("\n}\n", start) + 2).split("\n");
  }

  it("adds an `else if` for the hidden cases in the chain's own words, then an `else` that proves the rest", () => {
    expect(fixedFunction("discriminant").slice(3, 11)).toEqual([
      '  } else if (upload.kind === "running") {',
      "    return upload.pid;",
      '  } else if (upload.kind === "failed" || upload.kind === "retry") {',
      "    return -1;",
      "  } else {",
      "    upload satisfies never;",
      "    return -1;",
      "  }",
    ]);
    const finding = findingIn("discriminant");
    // Not `safe`, so `stateward check --fix` never applies it.
    expect(finding?.kind === "problem" ? finding.fixes[0]?.safe : "no finding").toBeUndefined();
    expect(findingIn("discriminant")).toMatchObject({
      fixes: [
        { title: "List the 2 hidden cases (same behaviour)" },
        { title: 'Add `upload.kind satisfies "failed" | "retry";` to the else', safe: false },
      ],
    });
  });

  it("keeps the value on the left when the chain writes it there, and an else without braces", () => {
    expect(fixedFunction("valueFirst").slice(5, 10)).toEqual([
      '  } else if ("x" === mode) return 0;',
      "  else {",
      "    mode satisfies never;",
      "    return 0;",
      "  }",
    ]);
  });

  it("writes enum members as the code does", () => {
    expect(fixedFunction("enums")[5]).toBe("  } else if (level === Level.High) {");
    expect(findingIn("enums")).toMatchObject({
      fixes: [
        { title: "List the hidden case (same behaviour)" },
        { title: "Add `level satisfies Level.High;` to the else", safe: false },
      ],
    });
  });

  it("tests null and undefined by value", () => {
    expect(fixedFunction("optional")[5]).toBe(
      "  } else if (size === null || size === undefined) {",
    );
  });

  it("tests with typeof in a typeof chain", () => {
    expect(fixedFunction("typeOf")[5]).toBe(
      '  } else if (typeof value === "boolean" || typeof value === "undefined") {',
    );
  });

  it("offers no fix when a hidden case is an object type", () => {
    expect(findingIn("shapes")).toMatchObject({ kind: "problem", fixes: [] });
  });

  it("compiles after each fix", () => {
    for (const name of ["discriminant", "valueFirst", "enums", "optional", "typeOf"]) {
      expect(typeErrors(fixedText(name))).toBe("");
    }
  });
});
