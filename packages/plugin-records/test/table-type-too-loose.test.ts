import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check as checkProject, createChecker } from "@stateward/core";
import { checkFixture } from "@stateward/core/testing";
import { parseConfig } from "@stateward/core";
import type { Finding, FixForm, Json } from "@stateward/core";
import { tableTypeTooLoose } from "../src/table-type-too-loose.js";
import { records } from "../src/index.js";
import {
  applied,
  check,
  fixture,
  inFile,
  shown,
  typeErrors,
  withFixesApplied,
  type Shown,
} from "./helpers.js";

const FLAGGED = fixture("table-type-too-loose/flagged");
const NOT_FLAGGED = fixture("table-type-too-loose/not-flagged");

const FIXED = "It is a fixed table: use satisfies";
/** No type names the keys: `satisfies` checks them as written. */
const AS_WRITTEN = "It is a fixed table: use satisfies (fixes only the keys written here)";
const open = (kind: string): string => `It is an open dictionary: Partial<Record<${kind}, …>>`;

/** The headline asks one question everywhere; names and types are shown whole. */
function headline(name: string, type: string): string {
  return `\`${name}\` is typed \`${type}\`: a fixed table or an open dictionary?`;
}

/** `V` and the key kind of `Record<string, V>` or `{ [key: string]: V }`. */
function parts(type: string): { value: string; kind: string } {
  const found = /^Record<(\w+), (.*)>$/.exec(type) ?? /^\{ \[\w+: (\w+)\]: (.*) \}$/.exec(type);
  return { kind: found?.[1] ?? "", value: found?.[2] ?? "" };
}

/**
 * A table that both fixes apply to: `keys` as the fixed-table spelling writes them (the union in
 * scope, or the literal keys), and the key list noted at the initializer.
 */
function record(file: string, name: string, type: string, keys: string, note: string): Shown {
  const { value, kind } = parts(type);
  return {
    file,
    name,
    message: headline(name, type),
    hint: `every key known: \`satisfies Record<${keys}, ${value}>\`; keys from outside: \`Partial<Record<${kind}, ${value}>>\``,
    notes: [`keys: ${note}`],
    fix: /^[A-Za-z]\w*$/.test(keys) ? FIXED : AS_WRITTEN,
  };
}

/**
 * A record some read of which uses a wider key: the open dictionary leads the hint, and is the
 * only fix (none for an exported table, which other files read).
 */
function wider(file: string, name: string, type: string, note: string, exported = false): Shown {
  const { value, kind } = parts(type);
  return {
    ...record(file, name, type, "", note),
    hint: `keys from outside: \`Partial<Record<${kind}, ${value}>>\`; every key known: look keys up as \`keyof typeof ${name}\`, then use \`satisfies\``,
    fix: exported ? undefined : open(kind),
  };
}

/** A record whose blocking reads look a key up again that came from `Object.keys` of it. */
function entries(file: string, name: string, type: string, note: string): Shown {
  const { value, kind } = parts(type);
  return {
    ...record(file, name, type, "", note),
    hint: `every key known: read \`Object.entries(${name})\`, then use \`satisfies\`; keys from outside: \`Partial<Record<${kind}, ${value}>>\``,
    fix: open(kind),
  };
}

function map(file: string, name: string, keys: string): Shown {
  return {
    file,
    name,
    message: `\`${name}\` is a Map with a fixed set of keys that is never changed`,
    hint: "use an object `{ … } satisfies Record<…>`, so a missing key fails to compile",
    notes: [`keys: ${keys}`],
    fix: undefined,
  };
}

const STRING = "Record<string, string>";
const NUMBER = "Record<string, number>";
const LONG_VALUE = "Record<string, TheValueOfEveryEntryInTheTable>";

describe("records/table-type-too-loose: flagged", () => {
  const findings = check(FLAGGED);

  it("reports a record or Map built from literal keys that nothing in the project changes", () => {
    expect(shown(findings)).toEqual([
      {
        file: "action-impacts.ts",
        name: "ACTION_IMPACTS",
        message:
          "`ACTION_IMPACTS` is typed `Record<string, string>`: a fixed table or an open dictionary?",
        hint: "every key known: `satisfies Record<Action, string>`; keys from outside: `Partial<Record<string, string>>`",
        notes: ['keys: "approve", "reject", "escalate"'],
        fix: FIXED,
      },
      record("const-record.ts", "titles", STRING, '"idle" | "done"', '"idle", "done"'),
      record(
        "imported.ts",
        "labels",
        STRING,
        '"idle" | "done" | "failed"',
        '"idle", "done", "failed"',
      ),
      wider("keys-of-itself-and-wide.ts", "stock", NUMBER, '"bolts", "nuts"'),
      entries("keys-of-itself-direct.ts", "heights", NUMBER, '"low", "high"'),
      entries("keys-of-itself-for-of.ts", "scores", NUMBER, '"ann", "bob"'),
      entries("keys-of-itself-map.ts", "widths", NUMBER, '"narrow", "wide"'),
      wider("keys-of-other.ts", "rates", NUMBER, '"day", "night"'),
      record("keys-of-other.ts", "periods", STRING, '"day" | "night"', '"day", "night"'),
      record("keys-read-by-union.ts", "levels", NUMBER, "Level", '"low", "high"'),
      record("let-record.ts", "sizes", NUMBER, '"small" | "large"', '"small", "large"'),
      {
        ...record(
          "long-names.ts",
          "aVeryLongVariableNameThatGoesOnAndOn",
          LONG_VALUE,
          "",
          '"first"',
        ),
        message:
          "`aVeryLongVariableNameThatGoesOnAndOn` is typed `Record<string, TheValueOfEveryEntryInTheTable>`: a fixed table or an open dictionary?",
        hint: 'every key known: `satisfies Record<"first", TheValueOfEveryEntryIn…>`; keys from outside: `Partial<Record<string, TheValueOfEveryEntryIn…>>`',
      },
      {
        ...record("long-names.ts", "shortName", LONG_VALUE, "", '"first"'),
        message:
          "`shortName` is typed `Record<string, TheValueOfEveryEntryInTheTable>`: a fixed table or an open dictionary?",
        hint: 'every key known: `satisfies Record<"first", TheValueOfEveryEntryIn…>`; keys from outside: `Partial<Record<string, TheValueOfEveryEntryIn…>>`',
      },
      {
        ...map("long-names.ts", "aVeryLongMapNameThatKeepsGoingOnAndOn", '"x"'),
        message:
          "`aVeryLongMapNameThatKeepsGoingOnAndOn` is a Map with a fixed set of keys that is never changed",
      },
      {
        ...record(
          "many-keys.ts",
          "weekdays",
          "{ [day: string]: number }",
          "",
          '"mon", "tue", "wed", "thu", "fri" and 2 more',
        ),
        hint: 'every key known: `satisfies Record<"mon" | "tue" | "wed" | "thu" | "fri" | …, number>`; keys from outside: `Partial<Record<string, number>>`',
      },
      record(
        "many-keys.ts",
        "oddKeys",
        "{ [key: string]: number }",
        '"extra-large" | 2 | "plain"',
        '"extra-large", 2, "plain"',
      ),
      map("map-imported.ts", "statusCodes", '"a", "b"'),
      map("map-loop.ts", "flags", '"dark"'),
      map("map-read.ts", "codes", '"ok", "missing"'),
      record("number-keys.ts", "sizeOfWidth", "Record<number, string>", "1 | 2 | 4", "1, 2, 4"),
      record("object-keys.ts", "names", STRING, '"a" | "b"', '"a", "b"'),
      record("readonly-param.ts", "palette", STRING, '"red" | "green"', '"red", "green"'),
      map("readonly-param.ts", "tones", '"dark"'),
      record("reexport.ts", "unitNames", STRING, '"m" | "s"', '"m", "s"'),
      wider("unknown-key.ts", "prices", NUMBER, '"apple", "pear"'),
      wider("wide-key.ts", "pageTitles", STRING, '"/", "/tasks"', true),
      wider("wide-key.ts", "sizeNames", STRING, '"s", "m"', true),
      wider("wide-key.ts", "roleLabels", STRING, '"admin", "editor"', true),
    ]);
  });

  it("covers reads in other files, through imports, renames, re-exports and namespaces", () => {
    const names = shown(findings).map((finding) => finding.name);
    expect(names).toContain("labels");
    expect(names).toContain("statusCodes");
    expect(names).toContain("unitNames");
  });

  it("asks its question in the same words for every table, and never cuts a name", () => {
    const question = ": a fixed table or an open dictionary?";
    const records = findings.filter((finding) => finding.message.includes(" is typed "));
    expect(records.length).toBeGreaterThan(20);
    expect(records.every((finding) => finding.message.endsWith(question))).toBe(true);
    const longName = records.find((finding) => finding.message.includes("aVeryLongVariableName"));
    expect(longName?.message).toContain("`aVeryLongVariableNameThatGoesOnAndOn` is typed");
    expect(longName?.message.length).toBeGreaterThan(100);
  });

  it("reports at the variable name, with the key list noted at the initializer", () => {
    const [first] = inFile(findings, "const-record.ts");
    expect(first?.kind).toBe("problem");
    if (first?.kind !== "problem") return;
    const text = readFileSync(first.location.file, "utf8");
    const note = first.related[0];
    expect(first.related).toHaveLength(1);
    expect(text.slice(note?.location.start, note?.location.end)).toBe(
      '{ idle: "Idle", done: "Done" }',
    );
    const [map] = inFile(findings, "map-read.ts");
    const mapText = readFileSync(map?.location.file ?? "", "utf8");
    expect(mapText.slice(map?.location.start, map?.location.end)).toBe("codes");
  });

  it("reports a record read through a JSX attribute", () => {
    expect(shown(check(fixture("table-type-too-loose/flagged-jsx")))).toEqual([
      record("panel.tsx", "items", STRING, '"one" | "two"', '"one", "two"'),
    ]);
  });
});

describe("records/table-type-too-loose: the quick fixes", { timeout: 30_000 }, () => {
  const findings = check(FLAGGED);

  function fixedText(file: string, title: string, index = 0): string {
    const finding = inFile(findings, file)[index];
    expect(finding?.kind).toBe("problem");
    if (finding?.kind !== "problem") return "";
    const fix = finding.fixes.find((one) => one.title === title);
    expect(fix).toBeDefined();
    return applied(readFileSync(finding.location.file, "utf8"), fix?.edits ?? []);
  }

  it("offers one fix per intent: the fixed table first, then the open dictionary", () => {
    const [finding] = inFile(findings, "const-record.ts");
    expect(finding?.kind === "problem" ? finding.fixes.map((fix) => fix.title) : []).toEqual([
      AS_WRITTEN,
      open("string"),
    ]);
  });

  it("checks a fixed table against the union in scope with its keys, or its keys written out", () => {
    expect(fixedText("action-impacts.ts", FIXED)).toContain("} satisfies Record<Action, string>;");
    expect(fixedText("keys-read-by-union.ts", FIXED)).toContain(
      "const levels = { low: 1, high: 2 } satisfies Record<Level, number>;",
    );
    expect(fixedText("const-record.ts", AS_WRITTEN)).toContain(
      'const titles = { idle: "Idle", done: "Done" } satisfies Record<"idle" | "done", string>;',
    );
    expect(fixedText("let-record.ts", AS_WRITTEN)).toContain(
      'let sizes = { small: 1, large: 2 } satisfies Record<"small" | "large", number>;',
    );
    expect(fixedText("imported.ts", AS_WRITTEN)).toBe(
      [
        "export const labels = {",
        '  idle: "Idle",',
        '  done: "Done",',
        '  failed: "Failed",',
        '} satisfies Record<"idle" | "done" | "failed", string>;',
        "",
      ].join("\n"),
    );
  });

  it("types an open dictionary `Partial<Record<…>>`, whatever form the annotation had", () => {
    expect(fixedText("const-record.ts", open("string"))).toContain(
      'const titles: Partial<Record<string, string>> = { idle: "Idle", done: "Done" };',
    );
    expect(fixedText("many-keys.ts", open("string"), 1)).toContain(
      "const oddKeys: Partial<Record<string, number>> = {",
    );
    expect(fixedText("number-keys.ts", open("number"))).toContain(
      "Partial<Record<number, string>>",
    );
  });

  it("offers the fixed table only when every read uses a key the record has", () => {
    const withoutFixedTable = findings
      .filter((finding) => finding.kind === "problem")
      .filter(
        (finding) => !finding.fixes.some((fix) => fix.title === FIXED || fix.title === AS_WRITTEN),
      )
      .map((finding) => shown([finding])[0]?.name);
    // The Maps, `prices[fruit]` with a `string` key (it would stop compiling), and keys taken
    // from `Object.keys` of the record.
    expect(withoutFixedTable).toEqual([
      "stock",
      "heights",
      "scores",
      "widths",
      "rates",
      "aVeryLongMapNameThatKeepsGoingOnAndOn",
      "statusCodes",
      "flags",
      "codes",
      "tones",
      "prices",
      "pageTitles",
      "sizeNames",
      "roleLabels",
    ]);
  });

  it("offers each intent only when the code still compiles after it (core tries both)", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [records()] }, FLAGGED);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: FLAGGED });
    const ours = checker
      .check()
      .findings.filter((one) => one.ruleId === "records/table-type-too-loose");
    const offered = (name: string): readonly string[] => {
      const review = checker
        .reviewFixes(ours)
        .find((one) => shown([one.finding])[0]?.name === name);
      return review?.finding.kind === "problem" ? review.finding.fixes.map((fix) => fix.title) : [];
    };
    // `impactOf` returns `string`: `Partial` would make the lookup `string | undefined`.
    expect(offered("ACTION_IMPACTS")).toEqual([FIXED]);
    // Nothing needs the value to be there: both intents compile.
    expect(offered("titles")).toEqual([AS_WRITTEN, open("string")]);
    // `levels[level]` returns `number`, as `impactOf` does.
    expect(offered("levels")).toEqual([FIXED]);
    // Exported: other files read it, and core checks only the file a fix edits.
    expect(offered("labels")).toEqual([AS_WRITTEN]);
    // A wider key: the fixed table would not compile; reads keep compiling as an open dictionary.
    expect(offered("prices")).toEqual([open("string")]);
  });

  it("says to type the key first: the code its hint describes compiles, the fix it replaces would not", () => {
    const text = (name: string): string => readFileSync(path.join(FLAGGED, name), "utf8");
    const source = text("wide-key.ts");
    // What a fixed-table fix would have done: TS7053 on `pageTitles[pathname]`.
    const naive = source.replace(
      "export const pageTitles: Record<string, string> = {",
      "export const pageTitles = {",
    );
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-wide-key-"));
    try {
      cpSync(FLAGGED, dir, { recursive: true });
      writeFileSync(
        path.join(dir, "wide-key.ts"),
        naive.replace(
          '"/tasks": "Tasks" };',
          '"/tasks": "Tasks" } satisfies Record<"/" | "/tasks", string>;',
        ),
      );
      expect(typeErrors(dir)).toContain("wide-key.ts");
      // What the hint says: keys typed `keyof typeof pageTitles`, then `satisfies`.
      writeFileSync(
        path.join(dir, "wide-key.ts"),
        [
          'export const pageTitles = { "/": "Home", "/tasks": "Tasks" } satisfies Record<"/" | "/tasks", string>;',
          "export function titleFor(pathname: keyof typeof pageTitles): string {",
          '  return pageTitles[pathname] ?? "Not found";',
          "}",
          "",
        ].join("\n"),
      );
      expect(typeErrors(dir)).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says to use Object.entries for keys taken from the record: after that the fixed table is offered", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-keys-of-itself-"));
    try {
      cpSync(FLAGGED, dir, { recursive: true });
      // What the hint says: key and value together, no second lookup.
      writeFileSync(
        path.join(dir, "keys-of-itself-map.ts"),
        [
          "const widths: Record<string, number> = { narrow: 10, wide: 40 };",
          "",
          "export const widthLines = Object.entries(widths).map(",
          "  ([key, value]) => `${key}=${String(value)}`,",
          ");",
          "",
        ].join("\n"),
      );
      expect(typeErrors(dir)).toBe("");
      const { findings: after } = checkFixture(dir, [records()]);
      const [finding] = inFile(after, "keys-of-itself-map.ts");
      expect(finding?.hint).toBe(
        'every key known: `satisfies Record<"narrow" | "wide", number>`; keys from outside: `Partial<Record<string, number>>`',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a project that still type-checks, with no errors, after each first fix", () => {
    expect(typeErrors(FLAGGED)).toBe("");
    const fixed = withFixesApplied(FLAGGED, findings, (copy) => ({
      errors: typeErrors(copy),
      text: readFileSync(path.join(copy, "const-record.ts"), "utf8"),
    }));
    expect(fixed.errors).toBe("");
    expect(fixed.text).toContain('satisfies Record<"idle" | "done", string>');
  });
});

const DOMAIN = fixture("table-type-too-loose/domain-type");

describe(
  "records/table-type-too-loose: fixes checked against the domain type and applied together",
  {
    timeout: 30_000,
  },
  () => {
    const parsed = parseConfig(
      { plugins: [records()], rules: { "records/table-type-too-loose": "error" } },
      DOMAIN,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: DOMAIN });
    const ours = checker
      .check()
      .findings.filter((one) => one.ruleId === "records/table-type-too-loose");
    const reviews = checker.reviewFixes(ours);
    /** The first fix of each finding in `file`, as core offers it. */
    const firstFixes = (file: string): FixForm[] =>
      reviews
        .filter((review) => path.basename(review.finding.location.file) === file)
        .flatMap((review) =>
          review.finding.kind === "problem" ? review.finding.fixes.slice(0, 1) : [],
        );
    const text = (name: string): string => readFileSync(path.join(DOMAIN, name), "utf8");

    it("writes the type the reads look the table up with, adding its import", () => {
      const [fix] = firstFixes("type-not-imported.ts");
      expect(fix?.title).toBe(FIXED);
      expect(applied(text("type-not-imported.ts"), fix?.edits ?? [])).toBe(
        [
          'import { touchpointStatus } from "./status.js";',
          'import type { TouchpointStatus } from "./status.js";',
          "",
          'const touchpointLabels = { open: "Open", closed: "Closed" } satisfies Record<TouchpointStatus, string>;',
          "",
          "export function currentLabel(): string {",
          "  return touchpointLabels[touchpointStatus()];",
          "}",
          "",
        ].join("\n"),
      );
    });

    it("uses the name the file already imports the type under, with no import added", () => {
      const [fix] = firstFixes("type-imported.ts");
      expect(fix?.title).toBe(FIXED);
      expect(fix?.edits).toHaveLength(2);
      expect(applied(text("type-imported.ts"), fix?.edits ?? [])).toContain(
        'const touchpointIcons = { open: "o", closed: "x" } satisfies Record<Status, string>;',
      );
    });

    it("removes an import a lone fix leaves unused, instead of rejecting the fix", () => {
      const [fix] = firstFixes("one-filter.ts");
      expect(fix?.title).toBe(AS_WRITTEN);
      expect(applied(text("one-filter.ts"), fix?.edits ?? [])).toBe(
        [
          "",
          'const pageFilters = { all: "All", mine: "Mine" } satisfies Record<"all" | "mine", string>;',
          "",
          "export function pageLabel(): string {",
          "  return pageFilters.all;",
          "}",
          "",
        ].join("\n"),
      );
    });

    it("removes an import two fixes leave unused only together, when they are applied as a set", () => {
      const fixes = firstFixes("two-filters.ts");
      expect(fixes.map((fix) => fix.title)).toEqual([AS_WRITTEN, AS_WRITTEN]);
      // Each alone keeps the other table's use of `FilterDictionary`.
      expect(fixes.map((fix) => fix.importCleanup)).toEqual([undefined, undefined]);
      const set = checker.verifyFixSet(fixes);
      expect(set.kept).toEqual([true, true]);
      expect(applied(text("two-filters.ts"), set.edits).startsWith("\nconst sortFilters = {")).toBe(
        true,
      );
    });

    it("leaves a project with no errors (TS6196 included) after the whole set is applied", () => {
      const all = reviews.flatMap((review) =>
        review.finding.kind === "problem" ? review.finding.fixes.slice(0, 1) : [],
      );
      const set = checker.verifyFixSet(all);
      expect(set.kept.every((kept) => kept)).toBe(true);
      const dir = mkdtempSync(path.join(tmpdir(), "stateward-domain-type-"));
      try {
        cpSync(DOMAIN, dir, { recursive: true });
        for (const file of new Set(set.edits.map((edit) => edit.location.file))) {
          const edits = set.edits.filter((edit) => edit.location.file === file);
          writeFileSync(
            path.join(dir, path.basename(file)),
            applied(readFileSync(file, "utf8"), edits),
          );
        }
        expect(typeErrors(DOMAIN)).toBe("");
        expect(typeErrors(dir)).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);

describe("records/table-type-too-loose: stated intent", () => {
  it("takes each of the four spellings at its word, and a spread as handed on", () => {
    const silent = check(NOT_FLAGGED).filter((finding) =>
      ["stated-intent.ts", "spread.ts"].includes(path.basename(finding.location.file)),
    );
    expect(silent).toEqual([]);
  });
});

describe("records/table-type-too-loose: not flagged", () => {
  it("says nothing when a key is written, the value escapes, the keys are not fixed, or every wider lookup handles a missing key (a Map too)", () => {
    expect(shown(check(NOT_FLAGGED))).toEqual([]);
  });

  it("does consider each of those variables, so the silence comes from how it is used", () => {
    const names: string[] = [];
    const watching = {
      ...tableTypeTooLoose,
      summarize(ctx: Parameters<typeof tableTypeTooLoose.summarize>[0]) {
        const summary = tableTypeTooLoose.summarize(ctx);
        names.push(...(summary?.candidates ?? []).map((candidate) => candidate.name));
        return summary;
      },
    };
    const plugin = { ...records(), rules: { "table-type-too-loose": watching } };
    const parsed = parseConfig({ preset: "recommended", plugins: [plugin] }, NOT_FLAGGED);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    expect(checkProject({ config: parsed.value, cwd: NOT_FLAGGED }).findings).toEqual([]);
    expect(names.sort()).toEqual(
      [
        "regElement",
        "regProperty",
        "regCompound",
        "regDelete",
        "regDefine",
        "regAssign",
        "regDestructure",
        "mapSet",
        "mapDelete",
        "mapClear",
        "mapPassed",
        "mapLoose",
        "toMutable",
        "returned",
        "assigned",
        "inArray",
        "inObject",
        "shorthand",
        "destructured",
        "stringified",
        "defaulted",
        "wrapped",
        "mapReturned",
        "mapSpread",
        "swapped",
        "nsLabels",
        "nsViaIndex",
        "foreignLabels",
        "foreignCodes",
        "roleLabels",
        "keyDeltas",
        "escapes",
        "imageTypes",
        "attributes",
        "prefixes",
        "protocols",
        "reasonLabels",
        "shortcuts",
        "specialCases",
        "TASK_AGENT_VIEWS",
        "defaults",
      ].sort(),
    );
  });
});

describe("records/table-type-too-loose: a project rule", () => {
  it("summarizes to JSON and gives the same findings whatever order the files are read in", () => {
    const copy = mkdtempSync(path.join(tmpdir(), "stateward-fixed-record-order-"));
    try {
      cpSync(FLAGGED, copy, { recursive: true });
      const files = readdirSync(copy).filter((name) => name.endsWith(".ts"));
      const compilerOptions = {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        types: [],
      };
      writeFileSync(
        path.join(copy, "tsconfig.forward.json"),
        JSON.stringify({ compilerOptions, files }),
      );
      writeFileSync(
        path.join(copy, "tsconfig.reversed.json"),
        JSON.stringify({ compilerOptions, files: [...files].reverse() }),
      );
      const summaries: Json[] = [];
      const watching = {
        ...tableTypeTooLoose,
        summarize(ctx: Parameters<typeof tableTypeTooLoose.summarize>[0]) {
          const summary = tableTypeTooLoose.summarize(ctx);
          if (summary !== undefined) summaries.push(summary);
          return summary;
        },
      };
      const plugin = { ...records(), rules: { "table-type-too-loose": watching } };
      const run = (tsconfig: string): readonly Finding[] => {
        const parsed = parseConfig({ preset: "recommended", plugins: [plugin], tsconfig }, copy);
        if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
        return checkProject({ config: parsed.value, cwd: copy }).findings;
      };
      const forward = run("tsconfig.forward.json");
      expect(forward.length).toBeGreaterThan(10);
      expect(run("tsconfig.reversed.json")).toEqual(forward);
      expect(summaries.length).toBeGreaterThan(10);
      for (const summary of summaries) {
        expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
      }
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

describe("records/table-type-too-loose when a key type does not resolve", () => {
  const UNRESOLVED = fixture("table-type-too-loose/unresolved-key");

  it("stays silent for the record, and the unresolved import is an unknown", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [records()] }, UNRESOLVED);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const { findings } = checkProject({ config: parsed.value, cwd: UNRESOLVED });
    expect(findings.map((one) => one.ruleId)).toEqual(["stateward/imports"]);
  });
});
