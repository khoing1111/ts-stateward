import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { applied, checkOnly, fixture, says, shown, typeErrorsOf } from "./helpers.js";

const RULE = "default-hides-cases";
const CASES = "unions/default-hides-cases";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

function inFile(name: string): Finding[] {
  return flagged().filter((finding) => finding.location.file.endsWith(name));
}

function hides(count: string, subject: string, labels: string): string {
  const noun = count === "1" ? "case" : "cases";
  return `this \`default\` hides ${count} ${noun} of \`${subject}\`: ${labels}`;
}

/**
 * The hint of a default that hides cases: list them and check `target` in the `default`, or say in
 * an ignore comment that the `default` is right for them; above `maxHidden` (`many`) the comment
 * comes first. Whether a quick fix is offered is core's call, so the hint does not say.
 */
function add(count: number, target: string, rest?: string, many = false): string {
  const n = String(count);
  const what = count === 1 ? "case" : "cases";
  const list = `list the ${what}, then put \`${target} satisfies never;\` in the \`default\``;
  // With `rest`, the example says which cases fall through; without it, an ignore comment does.
  const same =
    rest === undefined
      ? count === 1
        ? "if the `default` is right for it, say so above the `default`"
        : `if these ${n} cases all mean the same, say so above the \`default\``
      : count === 1
        ? "if the `default` is right for it, say so"
        : `if these ${n} cases all mean the same, say which`;
  return [
    many ? `${same}, or ${list}:` : `${list}, or ${same}:`,
    rest === undefined
      ? "    // stateward-ignore unions/default-hides-cases: <why>"
      : `    default: ${rest}`,
  ].join("\n");
}

function later(subject: string): string {
  return `\`default\` can't be reached today, but a new \`${subject}\` value would silently land here`;
}

/** The hint of a complete switch whose default has no proof, with the default's own statement. */
function prove(target: string, statement = "return 0;"): string {
  return [
    "keep the fallback but let TypeScript check it:",
    "    default:",
    `      ${target} satisfies never;`,
    ...(statement === "" ? [] : [`      ${statement}`]),
  ].join("\n");
}

function fixedLines(finding: Finding | undefined, file: string): string[] {
  expect(finding?.kind).toBe("problem");
  if (finding?.kind !== "problem") return [];
  expect(finding.fixes).toHaveLength(1);
  const fix = finding.fixes[0];
  const text = readFileSync(file, "utf8");
  return applied(text, fix?.edits ?? []).split("\n");
}

function aroundProof(lines: readonly string[]): string[] {
  const at = lines.findIndex((line) => line.includes("satisfies never"));
  return lines.slice(at - 1, at + 2);
}

describe(`unions/${RULE}: a default that hides cases`, () => {
  it("names the hidden cases, sorted, for unions, discriminants, null and undefined", () => {
    expect(shown(inFile("hidden.ts"))).toEqual([
      says(
        "hidden.ts",
        hides("2", "status.kind", '"cancel", "retry"'),
        add(2, "status", 'status.kind satisfies "cancel" | "retry";'),
      ),
      says("hidden.ts", hides("1", "mode", '"w"'), add(1, "mode", 'mode satisfies "w";')),
      says("hidden.ts", hides("2", "level", "2, 3"), add(2, "level", "level satisfies 2 | 3;")),
      says("hidden.ts", hides("1", "value", "null"), add(1, "value", "value satisfies null;")),
      says(
        "hidden.ts",
        hides("1", "value", "undefined"),
        add(1, "value", "value satisfies undefined;"),
      ),
      says(
        "hidden.ts",
        hides("1", "status . kind", '"idle"'),
        add(1, "status", 'status . kind satisfies "idle";'),
      ),
    ]);
  });

  it("labels enum members as the developer writes them", () => {
    expect(shown(inFile("enums.ts"))).toEqual([
      says(
        "enums.ts",
        hides("2", "color", "Color.Blue, Color.Green"),
        add(2, "color", "color satisfies Color.Blue | Color.Green;"),
      ),
      says(
        "enums.ts",
        hides("1", "level", "Level.Low"),
        add(1, "level", "level satisfies Level.Low;"),
      ),
    ]);
  });

  it("treats a boolean as true and false", () => {
    expect(shown(inFile("booleans.ts"))).toEqual([
      says("booleans.ts", hides("1", "on", "false"), add(1, "on", "on satisfies false;")),
    ]);
  });

  it("widens a type parameter to its constraint", () => {
    expect(shown(inFile("generic.ts"))).toEqual([
      says(
        "generic.ts",
        hides("2", "value", '"b", "c"'),
        add(2, "value", 'value satisfies "b" | "c";'),
      ),
    ]);
  });

  it("lists every hidden case up to maxHidden (5), none left out or counted; up to 5 hidden is still an error", () => {
    expect(shown(inFile("long.ts"))).toEqual([
      says(
        "long.ts",
        hides("5", "word", '"bravo", "charlie", "delta", "echo", "foxtrot"'),
        add(5, "word", 'word satisfies "bravo" | "charlie" | "delta" | "echo" | "foxtrot";'),
      ),
      says(
        "long.ts",
        hides("3", "word", '"delta", "echo", "foxtrot"'),
        add(3, "word", 'word satisfies "delta" | "echo" | "foxtrot";'),
      ),
      says(
        "long.ts",
        hides("4", "word", '"charlie", "delta", "echo", "foxtrot"'),
        add(4, "word", 'word satisfies "charlie" | "delta" | "echo" | "foxtrot";'),
      ),
    ]);
  });

  it("offers a quick fix that lists the hidden cases, not for --fix, and reports an error on the default keyword", () => {
    const [first] = inFile("hidden.ts");
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: CASES,
      severity: "error",
      related: [],
      fixes: [
        { title: "List the 2 hidden cases (same behaviour)" },
        { title: 'Add `status.kind satisfies "cancel" | "retry";` to the default', safe: false },
      ],
    });
    const text = readFileSync(fixture(`${RULE}/flagged/hidden.ts`), "utf8");
    expect(text.slice(first?.location.start, first?.location.end)).toBe("default");
  });
});

describe(`unions/${RULE}: every case handled, no proof`, () => {
  it("says the default will hide a case added later", () => {
    expect(shown(inFile("complete.ts"))).toEqual([
      says("complete.ts", later("status.kind"), prove("status")),
      says("complete.ts", later("status.kind"), prove("status")),
      says("complete.ts", later("flag"), prove("flag")),
      says("complete.ts", later("flag"), prove("flag", "")),
      says("complete.ts", later("flag"), prove("flag", "{ return 0; }")),
    ]);
  });

  it("is not a proof: a function named assertNever with a string parameter, another never, a plain call", () => {
    expect(shown(inFile("fakes.ts"))).toEqual([
      says("fakes.ts", later("mode"), prove("mode", "return assertNever(mode);")),
      says("fakes.ts", later("mode"), prove("mode", "return assertNever(unrelated);")),
      says("fakes.ts", hides("1", "mode", '"w"'), add(1, "mode", 'mode satisfies "w";')),
      says(
        "fakes.ts",
        later("mode"),
        prove("mode", '{ const unreachable: never = unrelated; return other === "r…'),
      ),
    ]);
  });

  it("fixes a default whose first statement is on its own line, at that indentation", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    const lines = fixedLines(inFile("complete.ts")[0], file);
    expect(aroundProof(lines)).toEqual([
      "    default:",
      "      status satisfies never;",
      "      return 0;",
    ]);
    expect(lines).toHaveLength(readFileSync(file, "utf8").split("\n").length + 1);
  });

  it("fixes a default whose statement shares the line, one level in from default", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[1], file))).toEqual([
      "    default:",
      "      status satisfies never;",
      "      return 0;",
    ]);
  });

  it("keeps tab indentation", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[2], file))).toEqual([
      "\t\tdefault:",
      "\t\t\tflag satisfies never;",
      "\t\t\treturn 0;",
    ]);
  });

  it("puts the proof before a block body", () => {
    const file = fixture(`${RULE}/flagged/complete.ts`);
    expect(aroundProof(fixedLines(inFile("complete.ts")[4], file))).toEqual([
      "    default:",
      "      flag satisfies never;",
      "      {",
    ]);
  });

  it("offers no fix for an empty default, which falls through and would change", () => {
    const [empty] = inFile("complete.ts").slice(3, 4);
    expect(empty).toMatchObject({ kind: "problem", fixes: [] });
  });

  it("titles the fix with the statement it adds", () => {
    const [first] = inFile("complete.ts");
    expect(first).toMatchObject({
      fixes: [{ title: "Add `status satisfies never;` to the default" }],
    });
  });
});

describe(`unions/${RULE}: a property of a plain object`, () => {
  it("proves the subject itself, which compiles there", () => {
    expect(shown(inFile("plain-object.ts"))).toEqual([
      says(
        "plain-object.ts",
        hides("2", "job.kind", '"cancel", "retry"'),
        add(2, "job.kind", 'job.kind satisfies "cancel" | "retry";'),
      ),
      says("plain-object.ts", later("job.kind"), prove("job.kind")),
    ]);
  });

  it("fixes with the subject", () => {
    const file = fixture(`${RULE}/flagged/plain-object.ts`);
    expect(aroundProof(fixedLines(inFile("plain-object.ts")[1], file))).toEqual([
      "    default:",
      "      job.kind satisfies never;",
      "      return 0;",
    ]);
  });
});

describe(`unions/${RULE}: the proof is on the object only for a discriminated union`, () => {
  it("proves the subject when `object.property` does not narrow the object", () => {
    expect(shown(inFile("targets.ts"))).toEqual([
      says("targets.ts", later("v.mode"), prove("v.mode")),
      says("targets.ts", later("s?.kind"), prove("s")),
      says("targets.ts", later("s.kind"), prove("s")),
      says("targets.ts", later("o.kind"), prove("o.kind")),
      says("targets.ts", later("t.kind"), prove("t")),
      says("targets.ts", later("x"), prove("x")),
    ]);
  });
});

describe(`unions/${RULE}: a proof that does not always run`, () => {
  it("does not count a proof inside an if, a function, a loop, a try, a branch or a nested switch", () => {
    const [all] = [inFile("conditional-proofs.ts")];
    const statements = [
      "{ if (flag) { fail(s); } return 0; }",
      "later(() => fail(s));",
      "for (const _ of [1]) fail(s);",
      "try { fail(s); } catch { return 0; }",
      "return flag && fail(s);",
      "return flag ? fail(s) : 0;",
      "switch (flag) { case true: return fail(s); case false: retu…",
    ];
    expect(shown(all)).toEqual(
      statements.map((statement) =>
        says("conditional-proofs.ts", later("s.kind"), prove("s", statement)),
      ),
    );
  });
});

describe(`unions/${RULE}: headlines stay short`, () => {
  it("never cuts a subject or a label: a long name makes the headline longer than 100", () => {
    const found = inFile("long-names.ts");
    expect(shown(found)).toEqual([
      says(
        "long-names.ts",
        'this `default` hides 2 cases of `thisIsAVeryLongVariableNameForTheUploadStatusObject.currentProcessingStageOfTheUploadPipeline`: "initialisingTheConnection", "uploadingTheFirstChunk"',
        add(
          2,
          "thisIsAVeryLongVariableNameForTheUploadStatusObject.currentProcessingStageOfTheUploadPipeline",
        ),
      ),
      says(
        "long-names.ts",
        later("thisIsAVeryLongVariableNameForTheUploadStatusObject.stage"),
        prove("thisIsAVeryLongVariableNameForTheUploadStatusObject.stage"),
      ),
    ]);
  });
});

describe(`unions/${RULE}: the quick fix compiles`, { timeout: 30_000 }, () => {
  const cases = [
    ["complete.ts", 0],
    ["complete.ts", 1],
    ["plain-object.ts", 1],
    ["targets.ts", 0],
    ["targets.ts", 1],
    ["targets.ts", 2],
    ["targets.ts", 3],
    ["targets.ts", 4],
    ["targets.ts", 5],
  ] as const;

  function textsOf(name: string, index: number): { original: string; fixed: string } | undefined {
    const file = fixture(`${RULE}/flagged/${name}`);
    const finding = inFile(name)[index];
    expect(finding?.kind).toBe("problem");
    if (finding?.kind !== "problem") return undefined;
    const original = readFileSync(file, "utf8");
    return { original, fixed: applied(original, finding.fixes[0]?.edits ?? []) };
  }

  let errors: ReadonlyMap<string, string> = new Map();
  beforeAll(() => {
    errors = typeErrorsOf(
      cases.flatMap(([name, index]) => {
        const texts = textsOf(name, index);
        return texts === undefined ? [] : [texts.original, texts.fixed];
      }),
    );
  });

  it.each(cases)("in %s, finding %i", (name, index) => {
    const texts = textsOf(name, index);
    if (texts === undefined) return;
    expect(errors.get(texts.original)).toBe("");
    expect(errors.get(texts.fixed)).toBe("");
  });
});

describe(
  `unions/${RULE}: the quick fix that says which cases fall through`,
  { timeout: 30_000 },
  () => {
    const file = fixture(`${RULE}/flagged/hidden.ts`);
    const original = readFileSync(file, "utf8");
    const finding = inFile("hidden.ts")[0];
    const fixed =
      finding?.kind === "problem" ? applied(original, finding.fixes[1]?.edits ?? []) : original;

    it("writes the check first in the default, keeping the default's body after it", () => {
      const lines = fixed.split("\n");
      const at = lines.findIndex((line) => line.includes("satisfies"));
      expect(lines.slice(at - 1, at + 2)).toEqual([
        "    default:",
        '      status.kind satisfies "cancel" | "retry";',
        "      return 0;",
      ]);
    });

    it("compiles", () => {
      expect(typeErrorsOf([fixed]).get(fixed)).toBe("");
    });
  },
);

describe(`unions/${RULE}: not flagged`, () => {
  it("accepts a switch over `typeof x`, with a proof or without", () => {
    expect(
      shown(
        checkOnly(fixture(`${RULE}/not-flagged`), RULE).filter((f) =>
          f.location.file.endsWith("typeof.ts"),
        ),
      ),
    ).toEqual([]);
  });

  it("accepts `o?.kind` over a possibly undefined plain object, where no proof can compile", () => {
    expect(
      shown(
        checkOnly(fixture(`${RULE}/not-flagged`), RULE).filter((f) =>
          f.location.file.endsWith("optional-chain.ts"),
        ),
      ),
    ).toEqual([]);
  });

  it("accepts the three proofs, the project's own helper, aliased imports and generics", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});

describe(`unions/${RULE}: the quick fix that lists the hidden cases`, { timeout: 30_000 }, () => {
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

  it("lists the hidden cases in the type's order, falling into the old body, then proves the rest", () => {
    expect(fixedFunction("generate")).toEqual([
      "export function generate(generatingType: GeneratingType, log: string[]): void {",
      "  switch (generatingType) {",
      '    case "summary":',
      '      log.push("summary");',
      "      break;",
      '    case "flashcards":',
      '    case "outline":',
      '    case "quiz":',
      "      break;",
      "    default:",
      "      generatingType satisfies never;",
      "  }",
      "}",
    ]);
  });

  it("titles the fix by the count, and keeps it out of --fix", () => {
    const finding = findingIn("generate");
    // Not `safe`, so `stateward check --fix` never applies it.
    expect(finding?.kind === "problem" ? finding.fixes[0]?.safe : "no finding").toBeUndefined();
    expect(findingIn("generate")).toMatchObject({
      fixes: [
        { title: "List the 3 hidden cases (same behaviour)" },
        {
          title: 'Add `generatingType satisfies "flashcards" | "outline" | "quiz";` to the default',
          safe: false,
        },
      ],
    });
    expect(findingIn("middleReturns")).toMatchObject({
      fixes: [
        { title: "List the 2 hidden cases (same behaviour)" },
        { title: 'Add `step satisfies "b" | "c";` to the default', safe: false },
      ],
    });
  });

  it("writes enum members as the code does, and ends the new default with the old return", () => {
    expect(fixedFunction("volume").slice(2, 10)).toEqual([
      "    case Tone.Calm:",
      "      return 1;",
      "    case Tone.Loud:",
      "    case Tone.Silent:",
      "      return 0;",
      "    default:",
      "      tone satisfies never;",
      "      return 0;",
    ]);
  });

  it("lists null and undefined for an optional subject", () => {
    expect(fixedFunction("optional").slice(4, 9)).toEqual([
      '    case "l":',
      '    case "m":',
      "    case null:",
      "    case undefined:",
      "      return 0;",
    ]);
  });

  it("keeps a case that falls into the default body, and adds a break where the body ran to the end", () => {
    expect(fixedFunction("fallThrough").slice(2, 13)).toEqual([
      '    case "a":',
      '      log.push("a");',
      "    // falls through",
      '    case "b":',
      '    case "c":',
      '    case "d":',
      '      log.push("rest");',
      "      break;",
      "    default:",
      "      step satisfies never;",
      "  }",
    ]);
    expect(fixedFunction("empty").slice(4, 9)).toEqual([
      "    case false:",
      "      break;",
      "    default:",
      "      flag satisfies never;",
      "  }",
    ]);
  });

  it("puts the new default right after a default in the middle that returns", () => {
    expect(fixedFunction("middleReturns").slice(2, 9)).toEqual([
      '    case "b":',
      '    case "c":',
      "      return 0;",
      "    default:",
      "      step satisfies never;",
      "      return 0;",
      '    case "a":',
    ]);
  });

  it("offers no list for a default that falls into the next case or a return that reads the body's names; only the inline check, which changes nothing but is the developer's choice", () => {
    for (const name of ["middle", "declares"]) {
      const finding = findingIn(name);
      expect(finding).toMatchObject({ kind: "problem", fixes: [{ safe: false }] });
      expect(finding?.kind === "problem" ? finding.fixes[0]?.title : "").toMatch(
        /^Add `.* satisfies .*;` to the default$/,
      );
    }
  });

  it("offers no fix for a call, which TypeScript does not narrow", () => {
    expect(findingIn("call")).toMatchObject({ kind: "problem", fixes: [] });
  });

  it("compiles after each fix, and after all of them at once", () => {
    const names = ["generate", "volume", "optional", "fallThrough", "middleReturns", "empty"];
    const all = applied(
      original,
      found.flatMap((f) => (f.kind === "problem" ? (f.fixes[0]?.edits ?? []) : [])),
    );
    const texts = [original, all, ...names.map(fixedText)];
    const errors = typeErrorsOf(texts);
    for (const text of texts) expect(errors.get(text)).toBe("");
  });
});

describe(`unions/${RULE}: a check whose type does not resolve`, () => {
  it("reports an unknown, not a problem, when the default hands the subject to an unresolved function", () => {
    const found = checkOnly(fixture(`${RULE}/unresolved`), RULE);
    expect(found.map((f) => f.kind)).toEqual(["unknown"]);
    expect(shown(found)).toEqual([
      says(
        "arrows.ts",
        "stateward cannot tell whether `exhaustiveSwitchError(…)` checks every case of `info.type`: its type does not resolve",
        "make its import resolve (install or build the package that declares it), or put `info satisfies never;` first in the `default`",
      ),
    ]);
  });
});

describe(`${CASES}: the check that names the cases falling through`, () => {
  // Review 5, proof 1: `Exclude<Status, "open">` grows when `Status` does, so a case added after
  // the fix fell into the `default` again without a word. The fix writes today's cases instead.
  const source = (members: string): string =>
    [
      `export type Status = ${members};`,
      "export function label(s: Status): string {",
      "  switch (s) {",
      '    case "open":',
      '      return "Open";',
      "    default:",
      '      return "Other";',
      "  }",
      "}",
      "",
    ].join("\n");

  it("writes the literal cases, is never applied by --fix, and a case added later is reported", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-rest-"));
    try {
      copyFileSync(fixture(`${RULE}/flagged/tsconfig.json`), path.join(dir, "tsconfig.json"));
      const file = path.join(dir, "a.ts");
      writeFileSync(file, source('"open" | "closed" | "pending"'));
      const [before] = checkOnly(dir, RULE);
      const rest = before?.kind === "problem" ? before.fixes[1] : undefined;
      expect(rest).toMatchObject({
        title: 'Add `s satisfies "closed" | "pending";` to the default',
        safe: false,
      });
      writeFileSync(file, applied(readFileSync(file, "utf8"), rest?.edits ?? []));
      expect(checkOnly(dir, RULE)).toEqual([]);
      const fixed = readFileSync(file, "utf8").replace('| "pending"', '| "pending" | "archived"');
      writeFileSync(file, fixed);
      expect(shown(checkOnly(dir, RULE)).map((s) => s.message)).toEqual([
        'this `default` hides 3 cases of `s`: "archived", "closed", "pending"',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
