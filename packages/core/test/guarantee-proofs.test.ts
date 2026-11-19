import { describe, expect, it } from "vitest";
import { counted, describeStatus, guaranteeAt, proveGuarantees } from "../src/guarantees.js";
import { unlistedGuarantees } from "../src/stated.js";
import type { Finding, StatedGuarantee } from "../src/types.js";

const RULE = "react-context/provider-missing";

function stated(name: string, start: number, covered: number): StatedGuarantee {
  return {
    guarantee: "required-context",
    marker: "RequiredContext",
    name,
    declaration: `/p/src/theme.ts#${String(start)}`,
    location: { file: "/p/src/theme.ts", start, end: start + 10 },
    ruleId: RULE,
    promise: "every reader is rendered under its Provider",
    covers: { one: "reader", many: "readers" },
    covered: Array.from({ length: covered }, (_, i) => ({
      name: `<Reader${String(i)}>`,
      location: { file: "/p/src/app.tsx", start: i * 10, end: i * 10 + 5 },
    })),
  };
}

function error(
  at: number,
  noteAt: number,
  ruleId = RULE,
  severity: "error" | "info" = "error",
): Extract<Finding, { kind: "problem" }> {
  return {
    kind: "problem",
    ruleId,
    severity,
    message: `missing at ${String(at)}`,
    hint: "h",
    location: { file: "/p/src/app.tsx", start: at, end: at + 1 },
    related: [
      {
        location: { file: "/p/src/theme.ts", start: noteAt, end: noteAt + 10 },
        message: "stated here",
      },
    ],
    fixes: [],
  };
}

describe("proveGuarantees", () => {
  const all = new Set([RULE]);

  it("counts the errors of its rule that name the declaration, and nothing else", () => {
    const proofs = proveGuarantees(
      [stated("Auth", 50, 1), stated("Theme", 0, 3)],
      [error(30, 0), error(10, 0), error(20, 50, "other/rule"), error(40, 0, RULE, "info")],
      all,
    );
    expect(proofs.map((proof) => [proof.stated.name, describeStatus(proof)])).toEqual([
      ["Theme", "not proven: 2 errors"],
      ["Auth", "proven for 1 reader"],
    ]);
    const first = proofs[0]?.status;
    expect(first?.kind === "unproven" ? first.errors.map((e) => e.location.start) : []).toEqual([
      10, 30,
    ]);
  });

  it("counts an error with no note at a declaration by the covered place it lies in", () => {
    // Theme covers app.tsx 0–5, 10–15, 20–25; Auth covers 0–5 as well.
    const unnamed = (at: number): Finding => ({ ...error(at, 0), related: [] });
    const proofs = proveGuarantees(
      [stated("Auth", 50, 1), stated("Theme", 0, 3)],
      [unnamed(21), unnamed(31), error(1, 50)],
      all,
    );
    expect(
      proofs.map((proof) => [
        proof.stated.name,
        proof.status.kind === "unproven" ? proof.status.errors.map((e) => e.location.start) : [],
      ]),
    ).toEqual([
      // 21 lies in a place only Theme covers; 31 in none; 1 names Auth, though Theme covers it too.
      ["Theme", [21]],
      ["Auth", [1]],
    ]);
  });

  it("says a marker nothing uses is unused, and one whose rule is not on is not checked", () => {
    expect(proveGuarantees([stated("Theme", 0, 0)], [], all).map(describeStatus)).toEqual([
      "unused: no reader, so nothing to prove; use it or drop the marker",
    ]);
    expect(proveGuarantees([stated("Theme", 0, 2)], [], new Set()).map(describeStatus)).toEqual([
      `not checked: ${RULE} is not on: turn it on in the config, or with \`stateward next\``,
    ]);
  });

  it("counts a finding the rule flags `against` at any severity, and an ignored one as not proven", () => {
    const against = (at: number, severity: "info" | "error"): Finding => ({
      ...error(at, 0, RULE, severity),
      against: true,
    });
    const [info] = proveGuarantees([stated("Theme", 0, 2)], [against(5, "info")], all);
    expect(info === undefined ? "" : describeStatus(info)).toBe("not proven: 1 error");
    const ignored = proveGuarantees([stated("Theme", 0, 2)], [], all, {
      ignored: [
        { finding: error(5, 0), reason: "lives as long as the app" },
        { finding: error(6, 0), reason: "lives as long as the app" },
      ],
    });
    expect(ignored.map(describeStatus)).toEqual([
      "not proven: 2 ignored — lives as long as the app",
    ]);
    const both = proveGuarantees([stated("Theme", 0, 2)], [error(5, 0)], all, {
      ignored: [{ finding: error(6, 0), reason: "" }],
    });
    expect(both.map(describeStatus)).toEqual(["not proven: 1 error, 1 ignored"]);
  });

  it("reads a rule that is off for a covered place, or a place it cannot follow, as not checked", () => {
    const off = proveGuarantees([stated("Theme", 0, 2)], [], all, {
      ruleOffAt: (_rule, file) => file === "/p/src/app.tsx",
    });
    expect(off.map(describeStatus)).toEqual([
      `not checked: ${RULE} is off for 2 readers: turn it on for them in the config`,
    ]);
    const one: StatedGuarantee = {
      ...stated("Theme", 0, 2),
      unchecked: [
        { location: { file: "/p/src/app.tsx", start: 0, end: 5 }, reason: "it is not read" },
      ],
    };
    const unchecked = proveGuarantees([one], [], all);
    expect(unchecked.map(describeStatus)).toEqual(["not checked: it is not read"]);
    expect(unchecked[0]?.status.kind).toBe("unchecked");
    // A finding still wins over a place not checked; a marker nothing reaches stays unused only then.
    expect(proveGuarantees([one], [error(2, 0)], all).map(describeStatus)).toEqual([
      "not proven: 1 error",
    ]);
  });

  it("reads a finding that names a declaration by the id, whatever its note, severity or place", () => {
    const named = (at: number, ids: string[], severity: "error" | "info" = "error"): Finding => ({
      ...error(at, 99, RULE, severity),
      related: [],
      guarantees: ids,
    });
    // 31 lies in no place Theme covers and its note is nowhere: only the id links it.
    const [theme, auth] = proveGuarantees(
      [stated("Theme", 0, 3), stated("Auth", 50, 1)],
      [named(31, ["/p/src/theme.ts#0"]), named(32, ["/p/src/theme.ts#50"], "info")],
      all,
    );
    expect(theme === undefined ? "" : describeStatus(theme)).toBe("not proven: 1 error");
    // A linked info counts: nothing a rule or a setting lowers it to keeps the guarantee proven.
    expect(auth === undefined ? "" : describeStatus(auth)).toBe("not proven: 1 error");
    // Linked, a finding does not fall back to where it lies: it is not about a place it only touches.
    const [kept] = proveGuarantees(
      [stated("Theme", 0, 3)],
      [named(21, ["/p/src/theme.ts#7"])],
      all,
    );
    expect(kept === undefined ? "" : describeStatus(kept)).toBe("proven for 3 readers");
    // Only the rule that proves it: another rule's finding at the same declaration is not about it.
    const [other] = proveGuarantees(
      [stated("Theme", 0, 3)],
      [{ ...named(21, ["/p/src/theme.ts#0"]), ruleId: "other/rule" }],
      all,
    );
    expect(other === undefined ? "" : describeStatus(other)).toBe("proven for 3 readers");
  });

  it("reads an unknown finding that names a guarantee as a place it is not checked, however it is shown", () => {
    const unknown = (shown?: "off" | "warning"): Finding => ({
      kind: "unknown",
      ruleId: RULE,
      message: "not checked: `api.current()` may be `Theme`",
      hint: "h",
      location: { file: "/p/src/app.tsx", start: 40, end: 50 },
      guarantees: ["/p/src/theme.ts#0"],
      ...(shown === undefined ? {} : { shown }),
    });
    for (const shown of [undefined, "warning", "off"] as const) {
      const [proof] = proveGuarantees([stated("Theme", 0, 3)], [unknown(shown)], all);
      expect(proof?.status.kind).toBe("unchecked");
      // The line says what is there, then the finding's fix.
      expect(proof === undefined ? "" : describeStatus(proof)).toBe(
        "not checked: `api.current()` may be `Theme`: h",
      );
    }
    // It leaves a marker nothing uses "not checked", not "unused"; one that names another is no one's.
    const [dead] = proveGuarantees([stated("Theme", 0, 0)], [unknown()], all);
    expect(dead?.status.kind).toBe("unchecked");
    const [elsewhere] = proveGuarantees([stated("Auth", 50, 1)], [unknown()], all);
    expect(elsewhere?.status.kind).toBe("proven");
    // A finding still wins over a place not checked.
    const [both] = proveGuarantees([stated("Theme", 0, 3)], [unknown(), error(1, 0)], all);
    expect(both?.status.kind).toBe("unproven");
  });

  it("reads a linked finding of a rule the config turned off where it lies as not checked there", () => {
    const silenced: Finding = {
      ...error(31, 99),
      related: [],
      guarantees: ["/p/src/theme.ts#0"],
    };
    const [proof] = proveGuarantees([stated("Theme", 0, 3)], [], all, { silenced: [silenced] });
    expect(proof?.status).toEqual({
      kind: "off",
      places: [{ file: "/p/src/app.tsx", start: 31, end: 32 }],
    });
  });

  it("states a stated declaration no plugin lists as not checked, and an error at it as not proven", () => {
    const declaration = {
      file: "/p/src/f.ts",
      start: 100,
      headEnd: 130,
      end: 150,
      name: "saving",
      marker: "Pending",
      guarantees: ["pending"],
    };
    const listed = stated("saving", 0, 1);
    // Nothing lists it: core does, and says so.
    const [one] = unlistedGuarantees([declaration], [listed]);
    expect(one?.declaration).toBe("/p/src/f.ts#100");
    const [read] = proveGuarantees(one === undefined ? [] : [one], [], new Set());
    expect(read === undefined ? "" : describeStatus(read)).toBe(
      "not checked: `Pending` is stated on a declaration no rule checks: state it where its pack's page shows",
    );
    // A guarantee of the same name that a plugin lists inside its head is the same one.
    expect(
      unlistedGuarantees(
        [declaration],
        [
          {
            ...listed,
            guarantee: "pending",
            location: { file: "/p/src/f.ts", start: 100, end: 150 },
          },
        ],
      ),
    ).toEqual([]);
    // A finding of any rule that notes it is against it.
    const note = {
      location: { file: "/p/src/f.ts", start: 100, end: 150 },
      message: "stated here",
    };
    const finding: Finding = { ...error(1, 0, "async/other"), related: [note] };
    const [wrong] = proveGuarantees(one === undefined ? [] : [one], [finding], new Set());
    expect(wrong === undefined ? "" : describeStatus(wrong)).toBe("not proven: 1 error");
  });

  it("reads a declaration only imports, exports and types refer to as unused, and one with an unread use as not checked", () => {
    const ref = (start: number, form: "import" | "type" | "read") => ({
      id: `/p/src/app.tsx#${String(start)}`,
      declaration: "/p/src/theme.ts#0",
      name: "Theme",
      marker: "RequiredContext",
      trait: "required-context",
      form,
      location: { file: "/p/src/app.tsx", start, end: start + 5 },
      text: "Theme",
    });
    const prove = (refs: ReturnType<typeof ref>[]) =>
      proveGuarantees([stated("Theme", 0, 0)], [], all, {
        ledger: { traits: ["required-context"], refs, marks: [] },
      }).map(describeStatus);
    expect(prove([ref(0, "import"), ref(10, "type")])).toEqual([
      "unused: referenced only by imports or types",
    ]);
    expect(prove([])).toEqual([
      "unused: no reader, so nothing to prove; use it or drop the marker",
    ]);
    // A use its rule did not read is not checked: the imports do not make it unused.
    expect(prove([ref(0, "import"), ref(20, "read")])).toEqual([
      "not checked: `Theme` (an import) is a use of `Theme` that stateward does not read for `RequiredContext`: write it the way `stateward explain react-context/provider-missing` shows (and 1 more)",
    ]);
  });

  it("finds the guarantee whose declaration holds an offset", () => {
    const proofs = proveGuarantees([stated("Theme", 0, 1), stated("Auth", 50, 1)], [], all);
    expect(guaranteeAt(proofs, "/p/src/theme.ts", 55)?.stated.name).toBe("Auth");
    expect(guaranteeAt(proofs, "/p/src/theme.ts", 30)).toBeUndefined();
    expect(guaranteeAt(proofs, "/p/src/app.tsx", 5)).toBeUndefined();
  });
});

describe("counted", () => {
  it("writes the noun in the form the count takes, as the noun gives it: never by adding an s", () => {
    const noun = { one: "switch", many: "switches" };
    expect([0, 1, 2].map((count) => counted(count, noun))).toEqual([
      "0 switches",
      "1 switch",
      "2 switches",
    ]);
    const one = { ...stated("Status", 0, 1), covers: noun };
    expect(proveGuarantees([one], [], new Set([RULE])).map(describeStatus)).toEqual([
      "proven for 1 switch",
    ]);
  });
});
