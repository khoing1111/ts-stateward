import { describe, expect, it } from "vitest";
import type { Finding } from "../src/internal.js";
import { MessageStandardError, expectMessageStandard, messageProblems } from "../src/testing.js";

const location = { file: "/a.ts", start: 0, end: 1 };

function problem(overrides: Partial<Extract<Finding, { kind: "problem" }>> = {}): Finding {
  return {
    kind: "problem",
    ruleId: "demo/rule",
    severity: "error",
    message: "`status` can also be failed",
    hint: "handle the failed case",
    location,
    related: [],
    fixes: [],
    ...overrides,
  };
}

describe("messageProblems: a hint with a code example", () => {
  it("allows one line, then up to four lines indented by 4 spaces, each at most 100 characters", () => {
    expect(messageProblems(problem({ hint: "why:\n    a\n      b\n    c\n    d" }))).toEqual([]);
  });

  it("refuses a fifth line, an unindented line and a long one", () => {
    expect(messageProblems(problem({ hint: "why:\n    a\n    b\n    c\n    d\n    e" }))).toEqual([
      "fix hint example has 5 lines; at most 4",
    ]);
    expect(messageProblems(problem({ hint: `why:\n    ${"x".repeat(97)}` }))).toEqual([
      "fix hint example line is 101 characters; at most 100",
    ]);
  });
});

describe("messageProblems", () => {
  it("accepts a good finding, problem or unknown", () => {
    expect(messageProblems(problem())).toEqual([]);
    const unknown: Finding = { kind: "unknown", ruleId: "r", message: "m", hint: "h", location };
    expect(messageProblems(unknown)).toEqual([]);
  });

  it("rejects an empty, multi-line or too long headline", () => {
    expect(messageProblems(problem({ message: " " }))).toEqual(["headline is empty"]);
    expect(messageProblems(problem({ message: "a\nb" }))).toEqual(["headline must be one line"]);
    expect(messageProblems(problem({ message: "x".repeat(101) }))).toEqual([
      "headline words are 101 characters without its names; at most 100",
    ]);
    expect(messageProblems(problem({ message: "x".repeat(100) }))).toEqual([]);
  });

  it("lets a headline or a fix line run past the limit only because of quoted names", () => {
    const name = `\`${"internalRefetchCount".repeat(6)}\``;
    expect(messageProblems(problem({ message: `${name} is read before it is set` }))).toEqual([]);
    expect(messageProblems(problem({ message: `${name} ${"x".repeat(100)}` }))).toEqual([
      "headline words are 101 characters without its names; at most 100",
    ]);
    expect(messageProblems(problem({ hint: `rename ${name}, then ${"y".repeat(100)}` }))).toEqual(
      [],
    );
    expect(messageProblems(problem({ hint: `rename ${name}, then ${"y".repeat(130)}` }))).toEqual([
      "fix hint words are 144 characters without its names; at most 140",
    ]);
  });

  it('rejects a headline that starts with "You" or has "!"', () => {
    expect(messageProblems(problem({ message: "You forgot it" }))).toEqual([
      'headline must not start with "You"',
    ]);
    expect(messageProblems(problem({ message: "Wrong!" }))).toEqual([
      'headline must not contain "!"',
    ]);
    expect(messageProblems(problem({ message: "Your chain misses it" }))).toEqual([
      'headline must not start with "You"',
    ]);
    expect(messageProblems(problem({ message: "Young trees" }))).toEqual([]);
  });

  it('reads only the prose: code in backticks may contain "!" or start with You', () => {
    expect(messageProblems(problem({ message: "`M` gets a placeholder value (`null!`)" }))).toEqual(
      [],
    );
    expect(messageProblems(problem({ message: "`You` is never read" }))).toEqual([]);
  });

  it("rejects an empty, multi-line or too long hint", () => {
    expect(messageProblems(problem({ hint: "" }))).toEqual(["fix hint is empty"]);
    expect(messageProblems(problem({ hint: "a\nb" }))).toEqual([
      'fix hint example line "b" must be indented by 4 spaces',
    ]);
    expect(messageProblems(problem({ hint: "x".repeat(141) }))).toEqual([
      "fix hint words are 141 characters without its names; at most 140",
    ]);
    expect(messageProblems(problem({ hint: "x".repeat(140) }))).toEqual([]);
  });

  it("rejects a related message with more than one line", () => {
    const related = [
      { location, message: "fine" },
      { location, message: "a\nb" },
    ];
    expect(messageProblems(problem({ related }))).toEqual(["related message 2 must be one line"]);
  });
});

describe("expectMessageStandard", () => {
  it("passes for good findings and for none", () => {
    expect(() => {
      expectMessageStandard([]);
      expectMessageStandard([problem()]);
    }).not.toThrow();
  });

  it("throws a MessageStandardError that lists every violation", () => {
    const bad = [problem({ message: "Oops!" }), problem({ hint: "" })];
    expect(() => {
      expectMessageStandard(bad);
    }).toThrow(MessageStandardError);
    expect(() => {
      expectMessageStandard(bad);
    }).toThrow(
      /2 message standard violation\(s\):\ndemo\/rule "Oops!": headline must not contain "!"\ndemo\/rule "`status` can also be failed": fix hint is empty$/,
    );
  });
});
