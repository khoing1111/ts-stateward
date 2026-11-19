import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check as checkProject, parseConfig } from "@stateward/core";
import { checkFixture, typeErrorsOfText } from "@stateward/core/testing";
import { reducers } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

/** The ways out of a state nothing leaves: an event, the mark where the module keeps it, the option. */
function neverLeft(tag: string, mark: string): string {
  return [
    "one of",
    `- handle an event that leaves "${tag}", so a case returns another state`,
    ...mark.split("\n"),
    "- or, to treat it as final in every reducer, list it under the rule's `finalStates` option:",
    `    { finalStates: ["${tag}"] }`,
  ].join("\n");
}

class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestError";
  }
}

const CHECKOUT = fixture("graph/checkout");
const UPLOAD = fixture("graph/upload");
const WIZARD = fixture("graph/wizard");
const UNREADABLE = fixture("graph/unreadable");
const ENTRY = fixture("graph/entry");
const DEFAULTED = fixture("graph/defaulted");
const NULLABLE = fixture("graph/nullable");
const PAYLOADS = fixture("graph/payloads");

const checkoutExpected: Shown[] = [
  {
    rule: "reducers/state-cannot-leave",
    severity: "warning",
    file: "reducer.ts",
    at: "checkoutReducer",
    message: '`checkoutReducer` reaches "paymentFailed" but never leaves it',
    hint: neverLeft(
      "paymentFailed",
      '- or add "paymentFailed" to `@final` on `CheckoutState` (quick fix)',
    ),
    notes: [
      'CheckoutPage.tsx: initialCheckout: starts at "cart"',
      'reducer.ts: { status: "paying", items: state.items, address: event.address }: "cart" goes to "paying" on `submitAddress`',
      'reducer.ts: { ...state, status: "paymentFailed", reason: event.reason }: "paying" goes to "paymentFailed" on `paymentFailed`',
    ],
    fixes: ['types.ts@142:  | "paymentFailed"'],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "reducer.ts",
    at: "checkoutReducer",
    message: '`checkoutReducer` never reaches "review": no case returns it',
    hint: [
      "one of",
      '- add the event that leads to "review", so a case returns it',
      '- or remove "review" from `CheckoutState`, if it is not used',
      '- or, if "review" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
    ].join("\n"),
    notes: [
      'CheckoutPage.tsx: initialCheckout: starts at "cart"',
      'types.ts: "review": "review" is declared',
    ],
    fixes: [],
  },
];

const uploadExpected: Shown[] = [
  {
    rule: "reducers/state-cannot-leave",
    severity: "error",
    file: "upload.ts",
    at: '@final "done" | "discarded" | "payed"',
    message: '`@final` names "payed", which is not a state of `UploadState`',
    hint: 'use one of: "discarded", "done", "draft", "failed", "idle", "queued", "scheduled", "sending"',
    notes: [],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "upload.ts",
    at: "uploadReducer",
    message: '`uploadReducer` never reaches "discarded": no case returns it',
    hint: [
      "one of",
      '- add the event that leads to "discarded", so a case returns it',
      '- or remove "discarded" from `UploadState`, if it is not used',
      '- or, if "discarded" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
    ].join("\n"),
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: "discarded": "discarded" is declared',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "upload.ts",
    at: "uploadReducer",
    message: '`uploadReducer` never reaches "draft": no case returns it',
    hint: [
      "one of",
      '- add the event that leads to "draft", so a case returns it',
      '- or remove "draft" from `UploadState`, if it is not used',
      '- or, if "draft" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
    ].join("\n"),
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: "draft": "draft" is declared',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "upload.ts",
    at: "uploadReducer",
    message: '`uploadReducer` never reaches "scheduled": only unreached "draft" leads to it',
    hint: [
      "one of",
      '- make "draft" reachable, so the cases that lead to "scheduled" can run',
      '- or remove "scheduled" from `UploadState`, if it is not used',
      '- or, if "scheduled" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
    ].join("\n"),
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: { phase: "scheduled", file: state.file }: returns "scheduled" only from "draft"',
      'upload.ts: "scheduled": "scheduled" is declared',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-cannot-leave",
    severity: "error",
    file: "upload.ts",
    at: '{ phase: "idle" }',
    message: '"done" is marked final, but `uploadReducer` leaves it on `restart`',
    hint: 'remove "done" from `@final`, or stop handling `restart` in "done"',
    notes: ['upload.ts: @final "done" | "discarded" | "payed": "done" is marked final'],
    fixes: [],
  },
];

const unreadableExpected: Shown[] = [
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "fetch.ts",
    at: "restored",
    message: "constant `restored` can be any state of `FetchState`",
    hint: [
      "one of",
      "- type it with the state it holds, `Extract<FetchState, { status: … }>`, and make whatever builds it give that type",
      '- or, if it may be any state on purpose, turn this kind off: `severities: { "whole-return": "off" }` in the rule\'s options',
    ].join("\n"),
    notes: ["fetch.ts: fetchReducer: in `fetchReducer`"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "error",
    file: "job.ts",
    at: '@initial "queud"',
    message: '`@initial` names "queud", which is not a state of `JobState`',
    hint: 'use one of: "done", "queued", "running"',
    notes: [],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "job.ts",
    at: "applyEvent(state, event)",
    message: "`applyEvent(state, event)` can return any state of `JobState`",
    // `applyEvent` gives back the state it is passed: a return type cannot say so, so writing its steps comes first.
    hint: [
      "one of",
      "- write the steps of `applyEvent` in the reducer, so each state it gives is read",
      "- or declare its return type as the states it gives, `Extract<JobState, { status: … }>`: only if it never gives back the state it is passed, which a return type cannot say",
      '- or, if it may be any state on purpose, turn this kind off: `severities: { "whole-return": "off" }` in the rule\'s options',
    ].join("\n"),
    notes: ["job.ts: jobReducer: in `jobReducer`"],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "unknown",
    file: "loose.ts",
    at: "external",
    message:
      "not checked: which state `external` returns: its type is not one state of `LooseState`",
    hint: "give it a type that is one of the states of `LooseState`, such as `Extract<LooseState, …>`",
    notes: [],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "prose.ts",
    at: "@final the order is done",
    message: "`@final` on `OrderState` lists states without quotes",
    hint: 'quote each state, e.g. `@final "done" | "open"`',
    notes: [],
    fixes: [],
  },
  {
    rule: "reducers/state-cannot-leave",
    severity: "warning",
    file: "prose.ts",
    at: "orderReducer",
    message: '`orderReducer` reaches "done" but never leaves it',
    hint: neverLeft("done", '- or add "done" to `@final` on `OrderState`'),
    notes: [
      'prose.ts: { stage: "open" }: starts at "open"',
      'prose.ts: event === "finish" && state.stage === "open" ? { stage: "done" } : state: "open" goes to "done"',
    ],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "queue.ts",
    at: "queueReducer",
    message: "`queueReducer` can start in any state: no start is known",
    hint: [
      "list, quoted, the states it can start in, above `queueReducer` (for example one state):",
      '    /** @initial "empty" */',
    ].join("\n"),
    notes: ["queue.ts: queueReducer: handed on"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "search.ts",
    at: "searchReducer",
    message: "`searchReducer` can start in any state: it is also used outside `useReducer`",
    hint: [
      "one of",
      "- list, quoted, the states it can start in, above `searchReducer` (for example one state):",
      '    /** @initial "found" */',
      "- or call it only through `useReducer`",
    ].join("\n"),
    notes: ["search.ts: searchReducer: called", "search.ts: searchReducer: called"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "session.ts",
    at: "saved",
    message: "`sessionReducer` can start in any state: the state it starts from is not known",
    hint: [
      "one of",
      "- start from a constant state",
      "- or list, quoted, the states it can start in, above `sessionReducer` (for example one state):",
      '    /** @initial "closed" */',
    ].join("\n"),
    notes: ["session.ts: sessionReducer: `sessionReducer` is declared"],
    fixes: [],
  },
];

describe("machines: a checkout flow (reducer, state, start and useReducer in four files)", () => {
  const findings = check(CHECKOUT);

  it("reports the state nothing leads to and the dead end, with the path to it", () => {
    expect(shown(CHECKOUT, findings)).toEqual(checkoutExpected);
  });

  it("makes the unreachable state an error and the dead end a warning with a quick fix", () => {
    expect(
      findings.map((finding) => [
        finding.ruleId,
        finding.kind === "problem" ? finding.severity : finding.kind,
      ]),
    ).toEqual([
      ["reducers/state-cannot-leave", "warning"],
      ["reducers/state-unreachable", "error"],
    ]);
  });

  it("adds the state to the existing @final tag with the quick fix", () => {
    const [deadEnd] = findings;
    if (deadEnd?.kind !== "problem") throw new TestError("expected a problem");
    const edits = deadEnd.fixes.flatMap((fix) => fix.edits);
    expect(deadEnd.fixes.map((fix) => fix.title)).toEqual(['Mark "paymentFailed" as final']);
    const [edit] = edits;
    if (edit === undefined) throw new TestError("expected an edit");
    const text = readFileSync(edit.location.file, "utf8");
    const fixed = text.slice(0, edit.location.start) + edit.newText + text.slice(edit.location.end);
    expect(fixed).toContain('/** @final "paid" | "cancelled" | "paymentFailed" */');
  });

  it("gives the same findings in the same order on a second run", () => {
    expect(checkFixture(CHECKOUT, [reducers()]).findings).toEqual(findings);
  });
});

describe("machines: an upload flow with @initial, a wrong @final and a final that is left", () => {
  it("reports each in full, states sorted by tag", () => {
    expect(shown(UPLOAD, check(UPLOAD))).toEqual(uploadExpected);
  });
});

describe("machines: a wizard with nested switches, init and a data condition", () => {
  it("has no finding when every state is reachable and the finals are listed", () => {
    expect(check(WIZARD)).toEqual([]);
  });
});

describe("reducers: a reducer that starts from its `state = initialState` default", () => {
  it("takes the default as its start, with no useReducer and no @initial", () => {
    expect(shown(DEFAULTED, check(DEFAULTED))).toEqual([
      {
        rule: "reducers/state-unreachable",
        severity: "error",
        file: "reducer.ts",
        at: "uploadReducer",
        message: '`uploadReducer` never reaches "retrying": no case returns it',
        hint: [
          "one of",
          '- add the event that leads to "retrying", so a case returns it',
          '- or remove "retrying" from `UploadState`, if it is not used',
          '- or, if "retrying" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
        ].join("\n"),
        notes: [
          'reducer.ts: initialUpload: starts at "idle"',
          'reducer.ts: "retrying": "retrying" is declared',
        ],
        fixes: [],
      },
    ]);
  });
});

describe("reducers/reducer-not-readable and the unknown of state-unreachable", () => {
  const findings = check(UNREADABLE);

  it("reports every place the graph cannot read, with the change that makes it checkable", () => {
    expect(shown(UNREADABLE, findings)).toEqual(unreadableExpected);
  });

  it("no longer offers a return type that its own helper cannot have", () => {
    // `applyEvent` gives back the state it is passed: the old example, `Extract<JobState, { status: "done" }>`, fails.
    const helper = (returnType: string): string =>
      [
        'type JobState = { status: "queued" } | { status: "running" } | { status: "done" };',
        `declare const flag: boolean;`,
        `export function applyEvent(state: JobState): ${returnType} {`,
        '  return flag ? { status: "running" } : state;',
        "}",
      ].join("\n");
    expect(typeErrorsOfText(helper('Extract<JobState, { status: "done" }>'))).toContain("TS2322");
    for (const finding of findings) {
      expect(finding.hint).not.toContain('{ status: "done" }');
    }
  });

  it("is info under recommended and an error under strict; the unknown stays unknown", () => {
    // `stated`: the findings against `@initial`, a guarantee the code states, which are errors
    // under every preset, so `check` and `guarantees` agree.
    const severities = (preset: "recommended" | "strict", stated: boolean): string[] => {
      const parsed = parseConfig({ plugins: [reducers()], preset }, UNREADABLE);
      if (!parsed.ok) throw new TestError(parsed.errors.join("\n"));
      return checkProject({ config: parsed.value, cwd: UNREADABLE }).findings.flatMap((finding) =>
        finding.ruleId === "reducers/reducer-not-readable" &&
        finding.kind === "problem" &&
        (finding.against === true) === stated
          ? [finding.severity]
          : [],
      );
    };
    expect(new Set(severities("recommended", false))).toEqual(new Set(["info"]));
    expect(new Set(severities("strict", false))).toEqual(new Set(["error"]));
    expect(new Set(severities("recommended", true))).toEqual(new Set(["error"]));
    expect(
      findings.filter((finding) => finding.kind === "unknown").map((finding) => finding.ruleId),
    ).toEqual(["reducers/state-unreachable"]);
  });

  it("treats a reducer exported from a package entry as starting anywhere", () => {
    expect(shown(ENTRY, check(ENTRY)).map((finding) => [finding.rule, finding.message])).toEqual([
      [
        "reducers/reducer-not-readable",
        "`parcelReducer` can start in any state: it is exported from the package",
      ],
    ]);
  });
});

describe("reducers/state-cannot-leave: final states in a `FINAL_STATES` const", () => {
  const FINALS = fixture("graph/finals");
  const findings = check(FINALS);

  it("reads the const as `@final`; a const nothing checks is not read", () => {
    expect(shown(FINALS, findings)).toEqual([
      {
        rule: "reducers/state-cannot-leave",
        severity: "warning",
        file: "order.ts",
        at: "orderReducer",
        message: '`orderReducer` reaches "failed" but never leaves it',
        hint: neverLeft("failed", '- or add "failed" to `ORDER_FINAL_STATES` (quick fix)'),
        notes: [
          'order.ts: INITIAL_STATE: starts at "open"',
          'order.ts: { status: "failed" }: "open" goes to "failed"',
        ],
        fixes: ['order.ts@350: , "failed"'],
      },
      {
        rule: "reducers/state-cannot-leave",
        severity: "warning",
        file: "ticket.ts",
        at: "ticketReducer",
        message: '`ticketReducer` reaches "stuck" but never leaves it',
        hint: neverLeft("stuck", '- or add "stuck" to `TICKET_FINAL_STATUSES` (quick fix)'),
        notes: [
          'ticket.ts: { status: "open" }: starts at "open"',
          'ticket.ts: event.type === "close" ? { status: "closed" } : { status: "stuck" }: "open" goes to "stuck"',
        ],
        // The const holds one name a line, so the new one gets its own line.
        fixes: ['ticket.ts@293: ,\n  "stuck"'],
      },
      {
        rule: "reducers/state-cannot-leave",
        severity: "warning",
        file: "ticket.ts",
        at: 'event.type === "reopen" ? { status: "open" } : state',
        message: '"closed" is marked final, but `ticketReducer` leaves it',
        hint: 'remove "closed" from `TICKET_FINAL_STATUSES`, or stop leaving it',
        notes: ['ticket.ts: TICKET_FINAL_STATUSES: "closed" is marked final'],
        fixes: [],
      },
    ]);
  });

  it("extends the const with the quick fix, and the result compiles and is quiet", () => {
    const [deadEnd] = findings;
    if (deadEnd?.kind !== "problem") throw new TestError("expected a problem");
    expect(deadEnd.fixes.map((fix) => fix.title)).toEqual(['Add "failed" to `ORDER_FINAL_STATES`']);
    const edits = deadEnd.fixes.flatMap((fix) => fix.edits);
    const [edit] = edits;
    if (edit === undefined) throw new TestError("expected an edit");
    const text = readFileSync(edit.location.file, "utf8");
    const fixed = text.slice(0, edit.location.start) + edit.newText + text.slice(edit.location.end);
    expect(fixed).toContain(
      'ORDER_FINAL_STATES = ["paid", "cancelled", "failed"] as const satisfies',
    );
  });
});

describe("reducers: a start of `null` or `undefined` when the state type includes it", () => {
  const found = shown(NULLABLE, check(NULLABLE)).map((finding) => [
    finding.file,
    finding.at,
    finding.message,
  ]);

  it("is a known start, as the argument and from an `init` function; the other findings stay", () => {
    expect(found.filter(([file]) => file !== "unknown.tsx")).toEqual([
      ["selection.tsx", "action.payload", "`action.payload` can return any state of `Selection`"],
      [
        "selection.tsx",
        "null",
        "not checked: which state `null` returns: its type is not one state of `Selection`",
      ],
    ]);
  });

  it("still reports a start of the state type from data, and `null` when the state type has no `null`", () => {
    expect(found.filter(([file]) => file === "unknown.tsx")).toEqual([
      [
        "unknown.tsx",
        "saved",
        "`selectionReducer` can start in any state: the state it starts from is not known",
      ],
      [
        "unknown.tsx",
        "null",
        "`tabReducer` can start in any state: the state it starts from is not known",
      ],
    ]);
  });
});

describe("reducers: a setter is not a state machine", () => {
  const found = shown(NULLABLE, check(NULLABLE));

  it("reads nothing of a reducer whose returns are the payload, an empty value or the state", () => {
    expect(found.filter((finding) => finding.file === "setter.tsx")).toEqual([]);
  });

  it("still reports `return action.payload` in a reducer that builds a state of its own", () => {
    expect(
      found
        .filter((finding) => finding.file === "selection.tsx" && finding.at === "action.payload")
        .map((finding) => finding.message),
    ).toEqual(["`action.payload` can return any state of `Selection`"]);
  });

  it("checks a machine whose payloads are each typed as one state: it is not a setter", () => {
    expect(shown(PAYLOADS, check(PAYLOADS)).map((finding) => finding.message)).toEqual([
      '`payloads` never reaches "verifying": no case returns it',
      // An `any` payload says nothing about the state: not a setter, and not checked.
      "not checked: which state `action.payload` returns: its type is not one state of `S`",
    ]);
  });
});
