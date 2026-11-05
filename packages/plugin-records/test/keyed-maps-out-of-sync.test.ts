import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard, ruleCode } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import { records } from "../src/index.js";
import { check, checkWithPreset, fixture, shown } from "./helpers.js";

const FLAGGED = fixture("keyed-maps-out-of-sync/flagged");
const NOT_FLAGGED = fixture("keyed-maps-out-of-sync/not-flagged");
const REMOVAL = fixture("keyed-maps-out-of-sync/removal");
const IGNORE_HINT =
  "or if they live for different times on purpose: `// stateward-ignore records/keyed-maps-out-of-sync: <why>`";
const RULE = "records/keyed-maps-out-of-sync";
const ON = {
  rules: {
    "records/table-type-too-loose": "off",
    "records/lookup-misses-key": "off",
    "records/duplicate-key": "off",
  },
  addons: ["records/keyed-maps"],
} as const;

/** How many problems have the severity. */
function severities(findings: readonly Finding[], severity: string): number {
  return findings.filter((finding) => finding.kind === "problem" && finding.severity === severity)
    .length;
}

describe(RULE, () => {
  it("suggests one record, as info, when every write and removal is paired", () => {
    const { findings } = checkFixture(FLAGGED, [records()], ON.rules, ON.addons);
    expectMessageStandard(findings);
    expect(shown(findings)).toEqual([
      {
        file: "hook.tsx",
        name: "labels",
        message: "`labels` and `counts` are both keyed by `ItemId` and always written together",
        hint: "one `Record<ItemId, { label; count }>` cannot get out of step (written together in `add`, `remove`)",
        notes: [
          "`add` writes `labels` and `counts` with `id`",
          "`remove` writes `labels` and `counts` with `id`",
        ],
        fix: undefined,
      },
      {
        file: "records.ts",
        name: "names",
        message: "`names` and `ages` are both keyed by `UserId` and always written together",
        hint: "one `Record<UserId, { name; age }>` cannot get out of step (written together in `addUser`, `renameUser`)",
        notes: [
          "`addUser` writes `names` and `ages` with `id`",
          "`renameUser` writes `names` and `ages` with `id`",
        ],
        fix: undefined,
      },
      {
        file: "records.ts",
        name: "titles",
        message: "`titles` and `owners` are both keyed by `number` and always written together",
        hint: "one `Record<number, { title; owner }>` cannot get out of step (written together in `addDoc`, `removeDoc`)",
        notes: [
          "`addDoc` writes `titles` and `owners` with `docId`",
          "`removeDoc` writes `titles` and `owners` with `docId`",
        ],
        fix: undefined,
      },
    ]);
  });

  it("reports a key or a reset that one table gets and its partner does not", () => {
    const { findings } = checkFixture(REMOVAL, [records()], ON.rules, ON.addons);
    expectMessageStandard(findings);
    const problems = shown(findings).filter((item) => item.hint.includes("both here"));
    expect(problems).toEqual([
      {
        file: "hook.tsx",
        name: "[id]: _gone",
        message: "deleting a row removes it from `labels` but not from `heights` (in `drop`)",
        hint: `remove it from both here, ${IGNORE_HINT}`,
        notes: ["`heights` is declared here; `drop` does not remove from it"],
        fix: undefined,
      },
      {
        file: "hook.tsx",
        name: "Object.entries(prev).filter(([key]) => key === keep)",
        message: "deleting a row removes it from `heights` but not from `labels` (in `trim`)",
        hint: `remove it from both here, ${IGNORE_HINT}`,
        notes: ["`labels` is declared here; `trim` does not remove from it"],
        fix: undefined,
      },
      {
        file: "maps.ts",
        name: "colors = {}",
        message: "clearing `colors` does not clear `counts` (in `resetTags`)",
        hint: `clear both here, ${IGNORE_HINT}`,
        notes: ["`counts` is declared here; `resetTags` does not clear it"],
        fix: undefined,
      },
      {
        file: "notes.ts",
        name: "delete viewEpochByNoteId[id]",
        message:
          "deleting a note removes it from `viewEpochByNoteId` but not from `savedRelevanceByNoteId`",
        hint: `remove it from both here, ${IGNORE_HINT}`,
        notes: ["`savedRelevanceByNoteId` is declared here; `removeNote` does not remove from it"],
        fix: undefined,
      },
    ]);
    expect(severities(findings, "warning")).toBe(4);
  });

  it("is silent when both setters filter, as `keepOnly` does", () => {
    const { findings } = checkFixture(REMOVAL, [records()], ON.rules, ON.addons);
    expect(shown(findings).filter((item) => item.message.includes("`keepOnly`"))).toEqual([]);
  });

  it("is silent for tables deleted and cleared together, and suggests one record for them", () => {
    const { findings } = checkFixture(REMOVAL, [records()], ON.rules, ON.addons);
    const cards = shown(findings).filter((item) => item.name === "titles");
    expect(cards).toEqual([
      {
        file: "maps.ts",
        name: "titles",
        message: "`titles` and `owners` are both keyed by `CardId` and always written together",
        hint: "one `Record<CardId, { title; owner }>` cannot get out of step (written together in `addCard`, `removeCard`)",
        notes: [
          "`addCard` writes `titles` and `owners` with `id`",
          "`removeCard` writes `titles` and `owners` with `id`",
        ],
        fix: undefined,
      },
    ]);
    const merge = findings.find((finding) => finding.message.includes("`titles`"));
    expect(merge?.kind === "problem" ? merge.severity : undefined).toBe("info");
  });

  it("reports nothing for other key types, one-sided writes, a derived cache, reads and arrays", () => {
    const { findings } = checkFixture(NOT_FLAGGED, [records()], ON.rules, ON.addons);
    expect(shown(findings)).toEqual([]);
    expect(check(NOT_FLAGGED, ON.rules)).toEqual([]);
  });

  it("is an add-on: nothing runs until it is switched on", () => {
    const { findings } = checkFixture(FLAGGED, [records()], ON.rules);
    expect(findings).toEqual([]);
  });

  it("is a heuristic warning, never an error, under every preset, with no quick fix", () => {
    const rule = ruleCode(records(), "keyed-maps-out-of-sync");
    expect(rule.meta.tier).toBe("addon");
    expect(rule.meta.addon).toBe("keyed-maps");
    expect(rule.meta.group).toBe("keys");
    expect(rule.meta.heuristic).toBe(true);
    for (const preset of ["recommended", "strict"] as const) {
      const ours = checkWithPreset(FLAGGED, preset, ON.rules).filter(
        (finding) => finding.ruleId === RULE,
      );
      expect(ours).toEqual([]);
    }
    const { findings } = checkFixture(FLAGGED, [records()], ON.rules, ON.addons);
    expect(findings).toHaveLength(3);
    const removal = checkFixture(REMOVAL, [records()], ON.rules, ON.addons).findings;
    for (const finding of [...findings, ...removal]) {
      expect(finding.kind).toBe("problem");
      expect(finding.kind === "problem" ? finding.severity : "").not.toBe("error");
      expect(finding.kind === "problem" ? finding.fixes : []).toEqual([]);
    }
  });

  it("explains itself", () => {
    const explain = ruleCode(records(), "keyed-maps-out-of-sync").meta.explain;
    expect(explain).toContain("# records/keyed-maps-out-of-sync");
    expect(explain).toContain("## Bad");
    expect(explain).toContain("## Good");
    expect(explain).toContain('rules: { "records/keyed-maps-out-of-sync": "off" }');
  });
});
