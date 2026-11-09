import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check as checkProject, createChecker } from "@stateward/core";
import { checkFixture } from "@stateward/core/testing";
import { parseConfig } from "@stateward/core";
import type { Finding, FixForm, Json } from "@stateward/core";
import { ambiguousTable } from "../src/ambiguous-table.js";
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

const FLAGGED = fixture("ambiguous-table/flagged");
const NOT_FLAGGED = fixture("ambiguous-table/not-flagged");

const FIXED = "Use satisfies: the keys are fixed";
/** No type the reads use names the keys: the object defines them. */
const AS_CONST = "Use as const: the object defines the keys";
/** `as const` does not compile: `satisfies` with the keys as written. */
const AS_WRITTEN = "Use satisfies with the keys as written: the keys are fixed";
const open = (kind: string): string => `Use Partial<Record<${kind}, …>>: keys come from outside`;

/** The headline says the same everywhere; names are shown whole. */
function headline(name: string, type: string): string {
  return `\`${name}\` accepts any ${parts(type).kind} key, so a misspelt or missing key still compiles`;
}

/** `V` and the key kind of `Record<string, V>` or `{ [key: string]: V }`. */
function parts(type: string): { value: string; kind: string } {
  const found = /^Record<(\w+), (.*)>$/.exec(type) ?? /^\{ \[\w+: (\w+)\]: (.*) \}$/.exec(type);
  return { kind: found?.[1] ?? "", value: found?.[2] ?? "" };
}

/** A fix line with ways to fix (M22). */
function ways(...lines: string[]): string {
  return ["one of", ...lines.map((line) => `- ${line}`)].join("\n");
}

/** How the fixed table is declared: `as const satisfies` with the key type its reads use, else `as const`. */
function fixedShort(name: string, keys: string, value: string): string {
  return keys === ""
    ? "remove the type and add `as const`"
    : `declare \`${name}\` with \`as const satisfies Record<${keys}, ${value}>\``;
}

/** The note at the key type the reads use, where it is declared. */
function keyTypeNote(name: string, keys: string): string[] {
  return keys === "" ? [] : [`\`${name}\` is read with \`${keys}\` keys, declared here`];
}

/**
 * A table that both fixes apply to: `keys` is the type its reads look it up with ("" when none),
 * and the key list noted at the initializer.
 */
function record(file: string, name: string, type: string, written: string, note: string): Shown {
  const { value, kind } = parts(type);
  // Keys written out (`"idle" | "done"`) name no declared type.
  const keys = /^[A-Za-z]\w*$/.test(written) ? written : "";
  const short = fixedShort(name, keys, value);
  return {
    file,
    name,
    message: headline(name, type),
    hint: ways(
      keys === ""
        ? `${short}: the object then defines its keys`
        : `${short}, so a missing key fails to compile`,
      `or type it \`Partial<Record<${kind}, ${value}>>\` for keys from outside`,
    ),
    notes: [`keys: ${note}`, ...keyTypeNote(name, keys)],
    fix: keys === "" ? AS_CONST : FIXED,
  };
}

/**
 * A record some read of which uses a wider key: the open dictionary and its choices lead the hint,
 * and it is the only fix (none for an exported table, which other files read).
 */
function wider(file: string, name: string, type: string, note: string, exported = false): Shown {
  const { value, kind } = parts(type);
  return {
    ...record(file, name, type, "", note),
    hint: ways(
      `type it \`Partial<Record<${kind}, ${value}>>\`, so each read handles a missing key`,
      "or use a `Map`, whose `get` returns `undefined` for a missing key",
      "or build it with `Object.create(null)`, so it has no inherited keys such as `toString`",
      `or check the key with \`isKeyOf(${name}, key)\` before reading`,
      `or, for fixed keys, look keys up as \`keyof typeof ${name}\`, then remove the type and add \`as const\``,
    ),
    fix: exported ? undefined : open(kind),
  };
}

/** A record whose blocking reads look a key up again that came from `Object.keys` of it. */
function entries(file: string, name: string, type: string, note: string): Shown {
  const { value, kind } = parts(type);
  return {
    ...record(file, name, type, "", note),
    hint: ways(
      `read \`Object.entries(${name})\` instead of looking keys up again, then remove the type and add \`as const\``,
      `or type it \`Partial<Record<${kind}, ${value}>>\` for keys from outside`,
    ),
    fix: open(kind),
  };
}

function map(file: string, name: string, keys: string): Shown {
  return {
    file,
    name,
    message: `\`${name}\` is a Map whose keys are fixed and never change`,
    hint: "use an object `{ … } satisfies Record<…>`, so a missing key fails to compile",
    notes: [`keys: ${keys}`],
    fix: undefined,
  };
}

const STRING = "Record<string, string>";
const NUMBER = "Record<string, number>";
const LONG_VALUE = "Record<string, TheValueOfEveryEntryInTheTable>";

describe("records/ambiguous-table: flagged", () => {
  const findings = check(FLAGGED);

  it("reports a record or Map built from literal keys that nothing in the project changes", () => {
    expect(shown(findings)).toEqual([
      record(
        "action-impacts.ts",
        "ACTION_IMPACTS",
        STRING,
        "Action",
        '"approve", "reject", "escalate"',
      ),
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
          "`aVeryLongVariableNameThatGoesOnAndOn` accepts any string key, so a misspelt or missing key still compiles",
      },
      {
        ...record("long-names.ts", "shortName", LONG_VALUE, "", '"first"'),
        message: "`shortName` accepts any string key, so a misspelt or missing key still compiles",
      },
      {
        ...map("long-names.ts", "aVeryLongMapNameThatKeepsGoingOnAndOn", '"x"'),
        message:
          "`aVeryLongMapNameThatKeepsGoingOnAndOn` is a Map whose keys are fixed and never change",
      },
      {
        ...record(
          "many-keys.ts",
          "weekdays",
          "{ [day: string]: number }",
          "",
          '"mon", "tue", "wed", "thu", "fri" and 2 more',
        ),
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

  it("says the same headline for every table, and never cuts a name", () => {
    const ending = " key, so a misspelt or missing key still compiles";
    const records = findings.filter((finding) => finding.message.includes(" accepts any "));
    expect(records.length).toBeGreaterThan(20);
    expect(records.every((finding) => finding.message.endsWith(ending))).toBe(true);
    const longName = records.find((finding) => finding.message.includes("aVeryLongVariableName"));
    expect(longName?.message).toContain("`aVeryLongVariableNameThatGoesOnAndOn` accepts any");
    expect(longName?.message).toBe(
      headline(
        "aVeryLongVariableNameThatGoesOnAndOn",
        "Record<string, TheValueOfEveryEntryInTheTable>",
      ),
    );
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
    expect(shown(check(fixture("ambiguous-table/flagged-jsx")))).toEqual([
      record("panel.tsx", "items", STRING, '"one" | "two"', '"one", "two"'),
    ]);
  });
});

describe("records/ambiguous-table: the quick fixes", { timeout: 30_000 }, () => {
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
      AS_CONST,
      open("string"),
    ]);
  });

  it("checks a fixed table against the type its reads use, else lets the object define its keys", () => {
    expect(fixedText("action-impacts.ts", FIXED)).toContain(
      "} as const satisfies Record<Action, string>;",
    );
    expect(fixedText("keys-read-by-union.ts", FIXED)).toContain(
      "const levels = { low: 1, high: 2 } as const satisfies Record<Level, number>;",
    );
    expect(fixedText("const-record.ts", AS_CONST)).toContain(
      'const titles = { idle: "Idle", done: "Done" } as const;',
    );
    expect(fixedText("let-record.ts", AS_CONST)).toContain(
      "let sizes = { small: 1, large: 2 } as const;",
    );
    expect(fixedText("imported.ts", AS_CONST)).toBe(
      [
        "export const labels = {",
        '  idle: "Idle",',
        '  done: "Done",',
        '  failed: "Failed",',
        "} as const;",
        "",
      ].join("\n"),
    );
  });

  it("falls back to satisfies without as const, or the keys as written, when as const does not compile", () => {
    const [finding] = inFile(findings, "action-impacts.ts");
    const fix = finding?.kind === "problem" ? finding.fixes[0] : undefined;
    expect(
      (fix?.alternatives ?? []).map((form) => form.edits.map((edit) => edit.newText).join("")),
    ).toEqual([" satisfies Record<Action, string>"]);
    const [titles] = inFile(findings, "const-record.ts");
    const asConst = titles?.kind === "problem" ? titles.fixes[0] : undefined;
    expect((asConst?.alternatives ?? []).map((form) => form.title)).toEqual([AS_WRITTEN]);
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
        (finding) => !finding.fixes.some((fix) => fix.title === FIXED || fix.title === AS_CONST),
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
    const ours = checker.check().findings.filter((one) => one.ruleId === "records/ambiguous-table");
    const offered = (name: string): readonly string[] => {
      const review = checker
        .reviewFixes(ours)
        .find((one) => shown([one.finding])[0]?.name === name);
      return review?.finding.kind === "problem" ? review.finding.fixes.map((fix) => fix.title) : [];
    };
    // `impactOf` returns `string`: `Partial` would make the lookup `string | undefined`.
    expect(offered("ACTION_IMPACTS")).toEqual([FIXED]);
    // Nothing needs the value to be there: both intents compile.
    expect(offered("titles")).toEqual([AS_CONST, open("string")]);
    // `levels[level]` returns `number`, as `impactOf` does.
    expect(offered("levels")).toEqual([FIXED]);
    // Exported: other files read it, and core checks only the file a fix edits.
    expect(offered("labels")).toEqual([AS_CONST]);
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
      // What the hint says: keys typed `keyof typeof pageTitles`, then `as const`.
      writeFileSync(
        path.join(dir, "wide-key.ts"),
        [
          'export const pageTitles = { "/": "Home", "/tasks": "Tasks" } as const;',
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
        record("keys-of-itself-map.ts", "widths", NUMBER, "", '"narrow", "wide"').hint,
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
    expect(fixed.text).toContain('const titles = { idle: "Idle", done: "Done" } as const;');
  });
});

const DOMAIN = fixture("ambiguous-table/domain-type");

describe(
  "records/ambiguous-table: fixes checked against the domain type and applied together",
  {
    timeout: 30_000,
  },
  () => {
    const parsed = parseConfig(
      { plugins: [records()], rules: { "records/ambiguous-table": "error" } },
      DOMAIN,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: DOMAIN });
    const ours = checker.check().findings.filter((one) => one.ruleId === "records/ambiguous-table");
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
          'const touchpointLabels = { open: "Open", closed: "Closed" } as const satisfies Record<TouchpointStatus, string>;',
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
        'const touchpointIcons = { open: "o", closed: "x" } as const satisfies Record<Status, string>;',
      );
    });

    it("removes an import a lone fix leaves unused, instead of rejecting the fix", () => {
      const [fix] = firstFixes("one-filter.ts");
      expect(fix?.title).toBe(AS_CONST);
      expect(applied(text("one-filter.ts"), fix?.edits ?? [])).toBe(
        [
          "",
          'const pageFilters = { all: "All", mine: "Mine" } as const;',
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
      expect(fixes.map((fix) => fix.title)).toEqual([AS_CONST, AS_CONST]);
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

describe("records/ambiguous-table: stated intent", () => {
  it("takes each of the four spellings at its word, and a spread as handed on", () => {
    const silent = check(NOT_FLAGGED).filter((finding) =>
      ["stated-intent.ts", "spread.ts"].includes(path.basename(finding.location.file)),
    );
    expect(silent).toEqual([]);
  });
});

describe("records/ambiguous-table: not flagged", () => {
  it("says nothing when a key is written, the value escapes, the keys are not fixed, or every wider lookup handles a missing key (a Map too)", () => {
    expect(shown(check(NOT_FLAGGED))).toEqual([]);
  });

  it("does consider each of those variables, so the silence comes from how it is used", () => {
    const names: string[] = [];
    const watching = {
      ...ambiguousTable,
      summarize(ctx: Parameters<typeof ambiguousTable.summarize>[0]) {
        const summary = ambiguousTable.summarize(ctx);
        names.push(...(summary?.candidates ?? []).map((candidate) => candidate.name));
        return summary;
      },
    };
    const plugin = { ...records(), rules: { "ambiguous-table": watching } };
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

describe("records/ambiguous-table: a project rule", () => {
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
        ...ambiguousTable,
        summarize(ctx: Parameters<typeof ambiguousTable.summarize>[0]) {
          const summary = ambiguousTable.summarize(ctx);
          if (summary !== undefined) summaries.push(summary);
          return summary;
        },
      };
      const plugin = { ...records(), rules: { "ambiguous-table": watching } };
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

describe("records/ambiguous-table when a key type does not resolve", () => {
  const UNRESOLVED = fixture("ambiguous-table/unresolved-key");

  it("stays silent for the record, and the unresolved import is an unknown", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [records()] }, UNRESOLVED);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const { findings } = checkProject({ config: parsed.value, cwd: UNRESOLVED });
    expect(findings.map((one) => one.ruleId)).toEqual(["stateward/imports"]);
  });
});

describe("records/ambiguous-table: the declared key type the reads use", () => {
  const KEY_TYPE = fixture("ambiguous-table/key-type");
  const findings = check(KEY_TYPE);

  it("names the type and where it is declared, with the Partial form when every read has a fallback", () => {
    expect(shown(findings)).toEqual([
      {
        file: "labels.ts",
        name: "labels",
        message: headline("labels", STRING),
        hint: ways(
          "declare `labels` with `as const satisfies Partial<Record<Status, string>>`: its reads with `Status` have a fallback",
          "or type it `Partial<Record<string, string>>` for keys from outside",
        ),
        notes: ['keys: "draft", "sent"', "`labels` is read with `Status` keys, declared here"],
        fix: open("string"),
      },
      {
        ...record("labels.ts", "colors", STRING, "Status", '"draft", "sent", "archived"'),
        fix: FIXED,
      },
    ]);
    const declared = findings.flatMap((finding) =>
      finding.kind === "problem" ? finding.related.slice(1) : [],
    );
    expect(
      declared.map((note) => [
        path.basename(note.location.file),
        readFileSync(note.location.file, "utf8").slice(note.location.start, note.location.end),
      ]),
    ).toEqual([
      ["status.ts", "Status"],
      ["status.ts", "Status"],
    ]);
  });
});
