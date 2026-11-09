import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, FixReview, TextEdit } from "@stateward/core";
import { records } from "../src/index.js";
import { HAS_OWN_TITLE, IS_KEY_OF_TITLE } from "../src/unchecked-key.js";
import { applied, check, fixture, inFile, typeErrors } from "./helpers.js";

const RULES = {
  "records/unchecked-key": "error",
  "records/ambiguous-table": "off",
} as const;

class UncheckedKeyTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UncheckedKeyTestError";
  }
}

/** Each finding as `line: headline`. */
function lines(findings: readonly Finding[]): string[] {
  return findings.map((finding) => {
    const text = readFileSync(finding.location.file, "utf8");
    const line = text.slice(0, finding.location.start).split("\n").length;
    return `${String(line)}: ${finding.message}`;
  });
}

/** The findings of the rule with their fixes as core offers them (each tried on a copy). */
function reviewed(dir: string): readonly FixReview[] {
  const parsed = parseConfig({ plugins: [records()], rules: RULES }, dir);
  if (!parsed.ok) throw new UncheckedKeyTestError(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir });
  const ours = checker
    .check()
    .findings.filter((finding) => finding.ruleId === "records/unchecked-key");
  return checker.reviewFixes(ours);
}

function offered(
  review: FixReview | undefined,
): readonly { title: string; edits: readonly TextEdit[] }[] {
  return review?.finding.kind === "problem" ? review.finding.fixes : [];
}

/** The project copied, `edits` applied (a missing file is created), and what `use` reads there. */
function withEdits<T>(dir: string, edits: readonly TextEdit[], use: (copy: string) => T): T {
  const copy = mkdtempSync(path.join(tmpdir(), "stateward-unchecked-key-"));
  try {
    cpSync(dir, copy, { recursive: true });
    const files = [...new Set(edits.map((edit) => edit.location.file))];
    for (const file of files) {
      const target = path.join(copy, path.relative(dir, file));
      const before = existsSync(file) ? readFileSync(file, "utf8") : "";
      writeFileSync(
        target,
        applied(
          before,
          edits.filter((edit) => edit.location.file === file),
        ),
      );
    }
    return use(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** The rule's findings over a fixture, each held to the message standard. */
function findingsOf(name: string): readonly Finding[] {
  return check(fixture(`unchecked-key/${name}`), RULES).filter(
    (finding) => finding.ruleId === "records/unchecked-key",
  );
}

describe("records/unchecked-key: flagged", () => {
  it("reports a cast to the table's keys, a cast under an `in` guard, and an `in` predicate", () => {
    expect(lines(inFile(findingsOf("flagged"), "labels.ts"))).toEqual([
      "6: the cast to `keyof typeof LABELS` does not check that `status` is a key of `LABELS`",
      "10: the cast to `Status` does not check that `status` is a key of `LABELS`",
      '15: `status in LABELS` also finds inherited keys such as "toString": the cast to `Status` is not checked',
      "20: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "25: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "31: the cast to `Status` does not check that `value` is a key of `COUNTS`",
      '35: `isStatus` tests `key in LABELS`, which also finds inherited keys such as "toString"',
      '38: `isLabelKey` tests `key in LABELS`, which also finds inherited keys such as "toString"',
    ]);
  });

  it("lists the ways to fix, the quick fix first", () => {
    const findings = inFile(findingsOf("flagged"), "labels.ts");
    const [cast] = findings;
    expect(cast?.hint).toBe(
      [
        "one of",
        "- check the key first with `isKeyOf(LABELS, status)`, a type predicate that uses `Object.hasOwn`",
        "- or use a `Map`: its `get` returns `undefined` for a missing key",
        "- or validate `status` where it enters the program, and type it as the key there",
      ].join("\n"),
    );
    const predicate = findings.at(-1);
    expect(predicate?.hint).toBe(
      [
        "one of",
        "- test with `Object.hasOwn(LABELS, key)`: it finds own keys only",
        "- or use a `Map` and its `has`",
      ].join("\n"),
    );
  });
});

describe("records/unchecked-key: not flagged", () => {
  it("passes reads checked with hasOwn, hasOwnProperty.call, isKeyOf or a predicate that uses them, and keys already typed", () => {
    expect(lines(inFile(findingsOf("not-flagged"), "labels.ts"))).toEqual([]);
  });

  it("passes keys taken from the same object, reads that handle a missing key, and keys checked against a list of valid keys", () => {
    expect(lines(inFile(findingsOf("not-flagged"), "shapes.ts"))).toEqual([]);
  });

  it("still reports keys of another object, a fallback on another value or on a key from the URL or storage, a test after the read, and a list test of another variable or a string", () => {
    expect(lines(inFile(findingsOf("flagged"), "variants.ts"))).toEqual([
      "8: the cast to `Status` does not check that `key` is a key of `LABELS`",
      "13: the cast to `Status` does not check that `key` is a key of `LABELS`",
      "18: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "22: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "29: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "34: the cast to `Status` does not check that `status` is a key of `LABELS`",
      "40: the cast to `Status` does not check that `status` is a key of `LABELS`",
      '45: the cast to `Status` does not check that `params.get("status")` is a key of `LABELS`',
      "50: the cast to `Status` does not check that `status` is a key of `LABELS`",
    ]);
  });
});

describe("records/unchecked-key: hints", () => {
  it("names the own-key test of the project's lib, read from another file when the file has no `Object`", () => {
    const [cast, predicate] = inFile(findingsOf("flagged"), "fixable.ts");
    expect(cast?.hint.split("\n")[1]).toBe(
      "- check the key first with `isKeyOf(LABELS, status)`, a type predicate that uses `Object.hasOwn`",
    );
    expect(predicate?.hint.split("\n")[1]).toBe(
      "- test with `Object.hasOwn(LABELS, key)`: it finds own keys only",
    );
  });

  it("names hasOwnProperty.call when the lib has no Object.hasOwn (ES2020)", () => {
    const [cast, predicate] = findingsOf("fix-es2020");
    expect(cast?.hint.split("\n")[1]).toBe(
      "- check the key first with `isKeyOf(LABELS, status)`, a type predicate that uses `Object.prototype.hasOwnProperty.call`",
    );
    expect(predicate?.hint.split("\n")[1]).toBe(
      "- test with `Object.prototype.hasOwnProperty.call(LABELS, key)`: it finds own keys only",
    );
  });

  it("names the project's own isKeyOf when there is one", () => {
    const [cast] = findingsOf("fix-existing");
    expect(cast?.hint.split("\n")[1]).toBe(
      "- check the key first with `isKeyOf(LABELS, status)`, the project's type predicate",
    );
  });

  it("puts a table that is not a plain reference in a const first, and names it short in the headline", () => {
    const findings = findingsOf("hints");
    expect(findings.map((finding) => finding.message)).toEqual([
      "the cast to `Status` does not check that `info.handle.id` is a key of `getArrowBindings(…)`",
      "the cast to `Status` does not check that `status` is a key of `TABLES[kind]`",
      '`isBound` tests `key in getArrowBindings(…)`, which also finds inherited keys such as "toString"',
    ]);
    const [call, element, predicate] = findings.map((finding) => finding.hint.split("\n")[1]);
    // The project has no reference to `Object`: the lib is not known, so the hints name no test.
    expect(call).toBe(
      "- put the object in a `const` first (`const bindings = getArrowBindings(…)`), then check the key with `isKeyOf(bindings, info.handle.id)`",
    );
    expect(element).toBe(
      "- put the object in a `const` first (`const table = TABLES[kind]`), then check the key with `isKeyOf(table, status)`",
    );
    expect(predicate).toBe(
      "- put the object in a `const` (`const bindings = getArrowBindings(…)`) and test own keys with `Object.hasOwn` or `hasOwnProperty.call`",
    );
    for (const finding of findings) {
      for (const line of finding.hint.split("\n")) expect(line.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("records/unchecked-key: quick fix", () => {
  it("writes isKeyOf with Object.hasOwn in src/keys.ts when the lib has ES2022, imports it and rewrites the read", () => {
    const dir = fixture("unchecked-key/flagged");
    const reviews = reviewed(dir).filter(
      (review) => path.basename(review.finding.location.file) === "fixable.ts",
    );
    const [cast, predicate] = reviews.map(offered);
    expect(cast?.map((fix) => fix.title)).toEqual([IS_KEY_OF_TITLE]);
    const edits = cast?.[0]?.edits ?? [];
    withEdits(dir, edits, (copy) => {
      expect(readFileSync(path.join(copy, "keys.ts"), "utf8")).toContain(
        "return Object.hasOwn(table, key);",
      );
      const fixed = readFileSync(path.join(copy, "fixable.ts"), "utf8");
      expect(fixed).toContain('import { isKeyOf } from "./keys.js";');
      expect(fixed).toContain("return isKeyOf(LABELS, status) ? LABELS[status] : undefined;");
      expect(typeErrors(copy)).toBe("");
    });
    expect(predicate?.map((fix) => fix.title)).toEqual([HAS_OWN_TITLE]);
    withEdits(dir, predicate?.[0]?.edits ?? [], (copy) => {
      expect(readFileSync(path.join(copy, "fixable.ts"), "utf8")).toContain(
        "return Object.hasOwn(LABELS, key);",
      );
    });
  });

  it("uses hasOwnProperty.call when the lib has no Object.hasOwn (ES2020)", () => {
    const dir = fixture("unchecked-key/fix-es2020");
    const [cast, predicate] = reviewed(dir).map(offered);
    const edits = cast?.[0]?.edits ?? [];
    withEdits(dir, edits, (copy) => {
      expect(readFileSync(path.join(copy, "keys.ts"), "utf8")).toContain(
        "return Object.prototype.hasOwnProperty.call(table, key);",
      );
      expect(typeErrors(copy)).toBe("");
    });
    withEdits(dir, predicate?.[0]?.edits ?? [], (copy) => {
      expect(readFileSync(path.join(copy, "labels.ts"), "utf8")).toContain(
        "return Object.prototype.hasOwnProperty.call(LABELS, key);",
      );
      expect(typeErrors(copy)).toBe("");
    });
  });

  it("imports the project's own isKeyOf instead of writing another", () => {
    const dir = fixture("unchecked-key/fix-existing");
    const [cast] = reviewed(dir).map(offered);
    const edits = cast?.[0]?.edits ?? [];
    expect(edits.map((edit) => path.relative(dir, edit.location.file))).toEqual([
      "src/labels.ts",
      "src/labels.ts",
    ]);
    withEdits(dir, edits, (copy) => {
      const fixed = readFileSync(path.join(copy, "src", "labels.ts"), "utf8");
      expect(fixed).toContain('import { isKeyOf } from "./util/object.js";');
      expect(typeErrors(copy)).toBe("");
    });
  });

  it("is not offered when the rewritten read does not compile", () => {
    const reviews = reviewed(fixture("unchecked-key/flagged")).filter(
      (review) => path.basename(review.finding.location.file) === "labels.ts",
    );
    // `LABELS[status as Status].toUpperCase()`: the read could be `undefined` after the fix.
    const shouted = reviews.find(
      (review) =>
        readFileSync(review.finding.location.file, "utf8")
          .slice(0, review.finding.location.start)
          .split("\n").length === 25,
    );
    expect(offered(shouted)).toEqual([]);
  });
});
