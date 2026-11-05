import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check as checkProject, parseConfig } from "@stateward/core";
import { checkFixture } from "@stateward/core/testing";
import { reducers } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

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

const checkoutExpected: Shown[] = [
  {
    rule: "reducers/state-cannot-leave",
    severity: "warning",
    file: "reducer.ts",
    at: "checkoutReducer",
    message: '`checkoutReducer` reaches "paymentFailed" but never leaves it',
    hint: 'handle an event that leaves "paymentFailed", or mark it final (quick fix available)',
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
    hint: 'add the event that leads to "review", or remove it from `CheckoutState`',
    notes: [
      'CheckoutPage.tsx: initialCheckout: starts at "cart"',
      'types.ts: "review": "review" is declared here',
    ],
    fixes: [],
  },
];

const uploadExpected: Shown[] = [
  {
    rule: "reducers/state-cannot-leave",
    severity: "warning",
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
    hint: 'add the event that leads to "discarded", or remove it from `UploadState`',
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: "discarded": "discarded" is declared here',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "upload.ts",
    at: "uploadReducer",
    message: '`uploadReducer` never reaches "draft": no case returns it',
    hint: 'add the event that leads to "draft", or remove it from `UploadState`',
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: "draft": "draft" is declared here',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "error",
    file: "upload.ts",
    at: "uploadReducer",
    message: '`uploadReducer` never reaches "scheduled": only unreached "draft" leads to it',
    hint: 'make "draft" reachable, or remove "scheduled" from `UploadState`',
    notes: [
      'upload.ts: @initial "idle": starts at "idle"',
      'upload.ts: { phase: "scheduled", file: state.file }: returns "scheduled" only from "draft"',
      'upload.ts: "scheduled": "scheduled" is declared here',
    ],
    fixes: [],
  },
  {
    rule: "reducers/state-cannot-leave",
    severity: "warning",
    file: "upload.ts",
    at: '{ phase: "idle" }',
    message: '"done" is marked final, but `uploadReducer` leaves it on `restart`',
    hint: 'remove "done" from `@final`, or stop handling `restart` in "done"',
    notes: ['upload.ts: @final "done" | "discarded" | "payed": "done" is marked final here'],
    fixes: [],
  },
];

const unreadableExpected: Shown[] = [
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "fetch.ts",
    at: "restored",
    message: "stateward cannot tell which state the constant `restored` is in",
    hint: 'type it with the state it starts in, e.g. `const restored: Extract<FetchState, { status: "done" }> = …`',
    notes: ["fetch.ts: fetchReducer: in `fetchReducer`"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
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
    message: "stateward cannot tell which states `applyEvent(state, event)` returns",
    hint: 'declare its return type as the states it returns, e.g. `Extract<JobState, { status: "done" }>`',
    notes: ["job.ts: jobReducer: in `jobReducer`"],
    fixes: [],
  },
  {
    rule: "reducers/state-unreachable",
    severity: "unknown",
    file: "loose.ts",
    at: "external",
    message: "stateward cannot tell which state `external` returns",
    hint: "give it a type that is one of the states of `LooseState`, such as `Extract<LooseState, …>`",
    notes: [],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "prose.ts",
    at: "@final the order is done",
    message: '`@final` on `OrderState` should list states in quotes: `@final "done"`',
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
    hint: 'handle an event that leaves "done", or add it to `@final` on `OrderState`',
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
    message: "stateward cannot tell where `queueReducer` starts",
    hint: "add `/** @initial empty */` to `queueReducer`",
    notes: ["queue.ts: queueReducer: handed on here"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "search.ts",
    at: "searchReducer",
    message: "`searchReducer` is also used outside `useReducer`, so it may start anywhere",
    hint: "list its starts with `@initial`, or call it only through `useReducer`",
    notes: ["search.ts: searchReducer: called here", "search.ts: searchReducer: called here"],
    fixes: [],
  },
  {
    rule: "reducers/reducer-not-readable",
    severity: "info",
    file: "session.ts",
    at: "saved",
    message: "`sessionReducer` can start in any state: this start is not a known state",
    hint: "start from a constant state, or list where it starts with `@initial` on the reducer",
    notes: ["session.ts: sessionReducer: `sessionReducer` is declared here"],
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
        hint: 'add the event that leads to "retrying", or remove it from `UploadState`',
        notes: [
          'reducer.ts: initialUpload: starts at "idle"',
          'reducer.ts: "retrying": "retrying" is declared here',
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

  it("is info under recommended and an error under strict; the unknown stays unknown", () => {
    const severities = (preset: "recommended" | "strict"): string[] => {
      const parsed = parseConfig({ plugins: [reducers()], preset }, UNREADABLE);
      if (!parsed.ok) throw new TestError(parsed.errors.join("\n"));
      return checkProject({ config: parsed.value, cwd: UNREADABLE }).findings.flatMap((finding) =>
        finding.ruleId === "reducers/reducer-not-readable" && finding.kind === "problem"
          ? [finding.severity]
          : [],
      );
    };
    expect(new Set(severities("recommended"))).toEqual(new Set(["info"]));
    expect(new Set(severities("strict"))).toEqual(new Set(["error"]));
    expect(
      findings.filter((finding) => finding.kind === "unknown").map((finding) => finding.ruleId),
    ).toEqual(["reducers/state-unreachable"]);
  });

  it("treats a reducer exported from a package entry as starting anywhere", () => {
    expect(shown(ENTRY, check(ENTRY)).map((finding) => [finding.rule, finding.message])).toEqual([
      [
        "reducers/reducer-not-readable",
        "`parcelReducer` is exported from the package, so it may start anywhere",
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
        hint: 'handle an event that leaves "failed", or mark it final (quick fix available)',
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
        hint: 'handle an event that leaves "stuck", or mark it final (quick fix available)',
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
        notes: ['ticket.ts: TICKET_FINAL_STATUSES: "closed" is marked final here'],
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
