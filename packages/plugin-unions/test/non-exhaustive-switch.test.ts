import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { proveGuarantees, describeStatus, type Finding } from "@stateward/core/internal";
import { unions } from "../src/index.js";
import { applied, checkOnly, fixture, says, shown, typeErrorsOf } from "./helpers.js";
import { typeErrors } from "@stateward/core/testing";

const RULE = "non-exhaustive-switch";
const ID = "unions/non-exhaustive-switch";

function inDir(dir: string, name?: string): Finding[] {
  return checkOnly(fixture(`${RULE}/${dir}`), RULE).filter(
    (finding) => name === undefined || finding.location.file.endsWith(`/${name}`),
  );
}

/** The labels as a headline lists them: the last joined by "and", unless the rest are counted. */
function listed(labels: readonly string[]): string {
  return labels.length === 1
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
}

function headline(subject: string, labels: readonly string[]): string {
  return `\`switch\` on \`${subject}\` does not handle ${listed(labels)}`;
}

/** The two bullets of M22: a `case` for each, or the allowance in the `default`. */
function fix(subject: string, labels: readonly string[]): string {
  const one = labels.length === 1;
  const add =
    labels.length > 3
      ? "add a `case` for each, with its own code"
      : `add ${listed(labels.map((label) => `\`case ${label}:\``))} with ${one ? "its" : "their"} own code`;
  return [
    "one of",
    `- ${add}`,
    `- or allow ${one ? "it" : "them"} in \`default\`: \`default: void (${subject} satisfies ${labels.join(" | ")});\``,
  ].join("\n");
}

function expected(file: string, subject: string, labels: readonly string[]) {
  return says(file, headline(subject, labels), fix(subject, labels));
}

describe(`${ID}: a default that handles cases it does not allow`, () => {
  it("names the cases, for unions, discriminants, numbers, null and undefined", () => {
    expect(shown(inDir("flagged", "hidden.ts"))).toEqual([
      expected("hidden.ts", "status.kind", ['"cancel"', '"retry"']),
      expected("hidden.ts", "mode", ['"w"']),
      expected("hidden.ts", "level", ["2", "3"]),
      expected("hidden.ts", "value", ["null"]),
      expected("hidden.ts", "value", ["undefined"]),
      expected("hidden.ts", "status . kind", ['"idle"']),
    ]);
  });

  it("writes enum members as the code does, booleans as true and false, a type parameter as its constraint", () => {
    expect(shown(inDir("flagged", "enums.ts"))).toEqual([
      expected("enums.ts", "color", ["Color.Blue", "Color.Green"]),
      expected("enums.ts", "level", ["Level.Low"]),
    ]);
    expect(shown(inDir("flagged", "booleans.ts"))).toEqual([
      expected("booleans.ts", "on", ["false"]),
    ]);
    expect(shown(inDir("flagged", "generic.ts"))).toEqual([
      expected("generic.ts", "value", ['"b"', '"c"']),
    ]);
  });

  it("lists every case up to maxHidden (5), and asks for a case for each above 3", () => {
    expect(shown(inDir("flagged", "long.ts")).map((one) => one.message)).toEqual([
      headline("word", ['"bravo"', '"charlie"', '"delta"', '"echo"', '"foxtrot"']),
      headline("word", ['"delta"', '"echo"', '"foxtrot"']),
      headline("word", ['"charlie"', '"delta"', '"echo"', '"foxtrot"']),
    ]);
    expect(shown(inDir("flagged", "long.ts"))[0]?.hint).toBe(
      [
        "one of",
        "- add a `case` for each, with its own code",
        "- or allow them in `default`:",
        '    default: void (word satisfies "bravo" | "charlie" | "delta" | "echo" | "foxtrot");',
      ].join("\n"),
    );
  });

  it("never cuts a name; an allowance too long for an example line is described", () => {
    const [long] = shown(inDir("flagged", "long-names.ts"));
    const subject =
      "thisIsAVeryLongVariableNameForTheUploadStatusObject.currentProcessingStageOfTheUploadPipeline";
    expect(long).toEqual(
      says(
        "long-names.ts",
        headline(subject, ['"initialisingTheConnection"', '"uploadingTheFirstChunk"']),
        [
          "one of",
          '- add `case "initialisingTheConnection":` and `case "uploadingTheFirstChunk":` with their own code',
          `- or allow them in \`default\` with \`void (${subject} satisfies …);\`, the cases joined by \`|\``,
        ].join("\n"),
      ),
    );
  });

  it("reports an error on the default keyword, with the two quick fixes, neither for --fix", () => {
    const [first] = inDir("flagged", "hidden.ts");
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: ID,
      severity: "error",
      findingKind: "hidden",
      related: [],
      fixes: [
        { title: "Add the 2 missing cases" },
        { title: 'Allow "cancel" and "retry" in `default`' },
      ],
    });
    if (first?.kind !== "problem") return;
    expect(first.fixes.every((one) => one.safe !== true)).toBe(true);
    const text = readFileSync(fixture(`${RULE}/flagged/hidden.ts`), "utf8");
    expect(text.slice(first.location.start, first.location.end)).toBe("default");
  });

  it("asks for a `const` first when the subject is computed, which TypeScript does not narrow", () => {
    const found = shown(checkOnly(fixture(`${RULE}/real-a`), RULE)).filter(
      (one) => one.file === "computed.ts",
    );
    expect(found).toEqual([
      says(
        "computed.ts",
        headline("getAlertMode()", ['"banner"', '"sound"']),
        [
          "one of",
          '- add `case "banner":` and `case "sound":` with their own code',
          "- or put the value in a `const` first (`const alertMode = getAlertMode(); switch (alertMode)`), then allow them in `default`",
        ].join("\n"),
      ),
    ]);
  });
});

describe(`${ID}: the opt-out model`, () => {
  it("does not report a default that cannot be reached, whatever it holds", () => {
    for (const name of ["complete.ts", "targets.ts", "conditional-proofs.ts"]) {
      expect(inDir("flagged", name)).toEqual([]);
    }
  });

  it("reads `x satisfies never` and a project's `never` helper like a plain default", () => {
    expect(shown(inDir("flagged", "fakes.ts"))).toEqual([expected("fakes.ts", "mode", ['"w"'])]);
    expect(inDir("not-flagged")).toEqual([]);
  });

  it("does not report the cases a `satisfies` check allows, even in a wider type; a check of another value allows nothing", () => {
    expect(shown(inDir("flagged", "rest-mismatch.ts"))).toEqual([
      expected("rest-mismatch.ts", "mode", ['"w"', '"x"']),
    ]);
  });

  it("reports the cases a partial allowance leaves out, and its fix adds them to it", () => {
    const found = inDir("allowances");
    expect(shown(found)).toEqual([expected("allow.ts", "mode", ['"x"'])]);
    const [partial] = found;
    if (partial?.kind !== "problem") throw new Error("expected a problem");
    const text = readFileSync(fixture(`${RULE}/allowances/allow.ts`), "utf8");
    expect(applied(text, partial.fixes[1]?.edits ?? [])).toContain(
      'void (mode satisfies "w" | "x");',
    );
  });
});

describe(`${ID}: the quick fixes compile`, { timeout: 60_000 }, () => {
  const dirs = ["flagged", "fixes", "real-a", "allowances", "no-default"] as const;
  let texts: {
    name: string;
    title: string;
    original: string;
    fixed: string;
    alternatives: string[];
  }[] = [];
  let errors: ReadonlyMap<string, string> = new Map();

  beforeAll(() => {
    texts = dirs.flatMap((dir) =>
      inDir(dir).flatMap((finding) => {
        if (finding.kind !== "problem") return [];
        const original = readFileSync(finding.location.file, "utf8");
        // Each form of a fix, as core tries them: the first that compiles is offered.
        return finding.fixes.map((one) => ({
          name: `${dir}/${finding.location.file.slice(finding.location.file.lastIndexOf("/") + 1)}@${String(finding.location.start)}`,
          title: one.title,
          original,
          fixed: applied(original, one.edits),
          alternatives: (one.alternatives ?? []).map((form) => applied(original, form.edits)),
        }));
      }),
    );
    errors = typeErrorsOf(texts.flatMap((one) => [one.original, one.fixed, ...one.alternatives]));
  });

  it("every fix of every finding: the code compiled before and compiles after", () => {
    expect(texts.length).toBeGreaterThan(40);
    const broken = texts
      .filter(
        (one) =>
          errors.get(one.original) === "" &&
          [one.fixed, ...one.alternatives].every((text) => errors.get(text) !== ""),
      )
      .map((one) => `${one.name} ${one.title}: ${errors.get(one.fixed) ?? ""}`);
    expect(broken).toEqual([]);
  });

  it("adds the cases before the default, so they run its code until they get their own", () => {
    const one = texts.find((text) => text.name.startsWith("flagged/hidden.ts@"));
    expect(one?.title).toBe("Add the 2 missing cases");
    const lines = (one?.fixed ?? "").split("\n");
    const at = lines.findIndex((line) => line.includes('case "cancel":'));
    expect(lines.slice(at, at + 4)).toEqual([
      '    case "cancel":',
      '    case "retry":',
      "    default:",
      "      return 0;",
    ]);
  });
});

describe(`${ID}: open unions (OpenUnion<T>)`, () => {
  const found = (): Finding[] => inDir("open-union");

  it("reports a switch without a default, naming the union, with a note at its declaration", () => {
    const [open, hidden] = found();
    expect(shown(found())).toEqual([
      says(
        "orders.ts",
        "`switch` on `order.status` does not handle a value outside `OrderStatus`, which is open",
        "add `default:` that handles an unknown status",
      ),
      expected("orders.ts", "status", ['"paid"', '"shipped"']),
    ]);
    expect(open).toMatchObject({
      findingKind: "open",
      related: [{ message: "`OrderStatus` is stated open (`OpenUnion`)" }],
    });
    // Both name the open union: `stateward guarantees` counts each against it.
    expect(hidden).toMatchObject({
      findingKind: "hidden",
      related: [{ message: "`OrderStatus` is stated open (`OpenUnion`)" }],
    });
  });

  it("is listed with its switches, and not proven while one has no default", () => {
    const dir = fixture(`${RULE}/open-union`);
    const parsed = parseConfig({ plugins: [unions()], preset: "recommended" }, dir);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    const result = checker.check();
    const proofs = proveGuarantees(checker.guarantees(), result.findings, new Set([ID]));
    expect(
      proofs.map((proof) => [
        proof.stated.marker,
        proof.stated.name,
        proof.stated.covered.length,
        describeStatus(proof),
      ]),
    ).toEqual([["OpenUnion", "OrderStatus", 4, "not proven: 2 errors"]]);
  });

  it("names the union however the switch gets its value: through an index file, destructured, or a `const` with no type", () => {
    const dir = fixture(`${RULE}/open-union-files`);
    const found = checkOnly(dir, RULE);
    expect(
      found.map((one) => [
        one.kind === "problem" ? one.findingKind : one.kind,
        one.kind === "problem" ? one.related.map((note) => note.message) : [],
      ]),
    ).toEqual([
      ["hidden", ["`OrderStatus` is stated open (`OpenUnion`)"]],
      ["open", ["`OrderStatus` is stated open (`OpenUnion`)"]],
      ["open", ["`OrderStatus` is stated open (`OpenUnion`)"]],
    ]);
    const parsed = parseConfig({ plugins: [unions()], preset: "recommended" }, dir);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    const result = checker.check();
    const proofs = proveGuarantees(checker.guarantees(), result.findings, new Set([ID]));
    expect(
      proofs.map((proof) => [
        proof.stated.name,
        proof.stated.covered.length,
        describeStatus(proof),
      ]),
    ).toEqual([["OrderStatus", 4, "not proven: 3 errors"]]);
  });
});

/** The two bullets for a `switch` without a `default`: a `case` for each, or a `default` that allows them. */
function fixWithoutDefault(subject: string, labels: readonly string[]): string {
  const one = labels.length === 1;
  return [
    "one of",
    `- add ${listed(labels.map((label) => `\`case ${label}:\``))} with ${one ? "its" : "their"} own code`,
    `- or add \`default:\` that allows ${one ? "it" : "them"}: \`default: void (${subject} satisfies ${labels.join(" | ")});\``,
  ].join("\n");
}

describe(`${ID}: a switch without a default`, { timeout: 60_000 }, () => {
  it("reports a missing case where TypeScript accepts it: no value returned, an inferred return type, code after the switch", () => {
    expect(shown(inDir("no-default", "missing.ts"))).toEqual([
      says("missing.ts", headline("s", ['"failed"']), fixWithoutDefault("s", ['"failed"'])),
      says("missing.ts", headline("s", ['"failed"']), fixWithoutDefault("s", ['"failed"'])),
      says("missing.ts", headline("s", ['"failed"']), fixWithoutDefault("s", ['"failed"'])),
      says(
        "missing.ts",
        headline("s", ['"done"', '"failed"']),
        fixWithoutDefault("s", ['"done"', '"failed"']),
      ),
    ]);
  });

  it("reports an error on the switch keyword, kind missing, with the two quick fixes", () => {
    const [first] = inDir("no-default", "missing.ts");
    expect(first).toMatchObject({
      kind: "problem",
      severity: "error",
      findingKind: "missing",
      related: [],
      fixes: [{ title: "Add the missing case" }, { title: 'Allow "failed" in `default`' }],
    });
    const text = readFileSync(fixture(`${RULE}/no-default/missing.ts`), "utf8");
    expect(first && text.slice(first.location.start, first.location.end)).toBe("switch");
  });

  it("is silent where TypeScript already reports the missing case, and on a switch that lists every case", () => {
    const errors = typeErrors(fixture(`${RULE}/no-default`));
    expect(errors).toMatch(/silent\.ts\(4,38\): error TS2366/);
    expect(errors).toMatch(/silent\.ts\(16,51\): error TS2366/);
    expect(inDir("no-default", "silent.ts")).toEqual([]);
    expect(typeErrors(fixture(`${RULE}/implicit-returns`))).toMatch(
      /inferred\.ts\(4,17\): error TS7030/,
    );
    expect(shown(inDir("implicit-returns"))).toEqual([
      says(
        "inferred.ts",
        headline("s", ['"done"', '"failed"', '"running"']),
        [
          "one of",
          '- add `case "done":`, `case "failed":` and `case "running":` with their own code',
          '- or add `default:` that allows them: `default: void (s satisfies "done" | "failed" | "running");`',
        ].join("\n"),
      ),
    ]);
  });

  it("adds the case after the last clause, which keeps running what it ran", () => {
    const text = readFileSync(fixture(`${RULE}/no-default/missing.ts`), "utf8");
    const [log, , , shared] = inDir("no-default", "missing.ts");
    if (log?.kind !== "problem" || shared?.kind !== "problem") throw new Error("expected problems");
    expect(applied(text, log.fixes[0]?.edits ?? [])).toContain(
      [
        '      console.log("done"); // the last clause runs on to the end',
        "      break;",
        '    case "failed":',
        "      break;",
        "  }",
      ].join("\n"),
    );
    expect(applied(text, log.fixes[1]?.edits ?? [])).toContain(
      [
        '      console.log("done"); // the last clause runs on to the end',
        "      break;",
        "    default:",
        '      void (s satisfies "failed");',
        "  }",
      ].join("\n"),
    );
    // The default shares the empty last clause, so the allowance names it too.
    const allow = shared.fixes[1];
    expect(
      [allow, ...(allow?.alternatives ?? [])].map((form) => applied(text, form?.edits ?? [])),
    ).toContainEqual(expect.stringContaining('void (s satisfies "running" | "done" | "failed");'));
  });

  it("leaves the finding of an open union's switch without a default as it was: every case listed, one finding", () => {
    expect(
      inDir("open-union").map((one) => (one.kind === "problem" ? one.findingKind : one.kind)),
    ).toEqual(["open", "hidden"]);
  });
});
