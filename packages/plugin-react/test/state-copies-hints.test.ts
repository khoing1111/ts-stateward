import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import type { Finding, RuleConfig } from "@stateward/core";
import { stateCopiesProp } from "../src/state-copies-prop.js";
import { check, fixture, inCopy, shown } from "./helpers.js";
import type { Replacement } from "./helpers.js";

const DIR = fixture("state-copies");
const RULE = "react/state-copies-prop";
const ofRule = (dir: string, setting: RuleConfig = "warning"): Finding[] =>
  check(dir, { [RULE]: setting }).filter((one) => one.ruleId === RULE);
const found = ofRule(DIR);

const ignoreWay = (state: string): string[] => [
  `- or if the prop is meant to reset \`${state}\` this way, list it under the rule's \`ignore\` option:`,
  `    { ignore: ["${state}"] }`,
];

describe(`${RULE}: the readings of a copy`, () => {
  it("offers a derived value built from a new state, a `key` and `ignore`, with no placeholder state", () => {
    expect(shown(DIR, found).map((one) => [one.file, one.message, one.hint])).toEqual([
      [
        "Badge.tsx",
        "`shown` copies the prop `label` and an effect keeps them in sync",
        [
          "one of",
          "- use `label` directly, with no state",
          "- or drop the effect and render `<Badge key={…}>` so it starts over when `label` changes",
          ...ignoreWay("shown"),
        ].join("\n"),
      ],
      [
        "Guard.tsx",
        "`shouldBlock` copies the prop `isDirty`, except when set elsewhere, and an effect keeps them in sync",
        [
          "one of",
          "- derive it from `isDirty`: add a state that `handleProceed` sets to the current `isDirty` in place of setting `shouldBlock` to `false`, and use `false` only while that state equals `isDirty`",
          "- or drop the effect and render `<LeaveGuard key={…}>` so it starts over when `isDirty` changes",
          ...ignoreWay("shouldBlock"),
        ].join("\n"),
      ],
      [
        "Note.tsx",
        "effect overwrites the draft `draft` with `body` whenever it changes: edits are lost",
        [
          "one of",
          "- drop the effect and render `<Note key={…}>` so the draft starts over when `body` changes",
          ...ignoreWay("draft"),
        ].join("\n"),
      ],
    ]);
  });

  it("no longer shows `<that state>`, and the page no longer says a same text is a change", () => {
    for (const finding of found) expect(finding.hint).not.toContain("<that state>");
    const page = stateCopiesProp.meta.explain;
    expect(page).not.toContain("<that state>");
    expect(page).not.toContain("even the same text in a new render of a list");
  });

  it("is silent for a state listed under `ignore` exactly as the hint shows", () => {
    for (const finding of found) {
      const listed = finding.hint.split("\n").at(-1)?.trim() ?? "";
      const names: unknown = JSON.parse(listed.replace(/^\{ ignore: /, "").replace(/ \}$/, ""));
      if (!Array.isArray(names) || !names.every((one) => typeof one === "string")) {
        throw new Error("the hint lists names");
      }
      expect(ofRule(DIR, ["warning", { ignore: names }])).toHaveLength(found.length - 1);
    }
  });
});

const file = (name: string): string => path.join(DIR, name);
const wholeFile = (name: string, text: string): Replacement => ({
  file: file(name),
  start: 0,
  end: readFileSync(file(name), "utf8").length,
  text,
});

describe(`${RULE}: each reading, written out, compiles and is silent`, () => {
  const compilesAndIsSilent = (replacement: Replacement, removed: number): void => {
    inCopy(DIR, [replacement], (copy) => {
      expect(typeErrors(copy)).toBe("");
      expect(ofRule(copy)).toHaveLength(found.length - removed);
    });
  };

  it("derives `shouldBlock` from a state that records the event, which follows `isDirty` again when it changes", () => {
    compilesAndIsSilent(
      wholeFile(
        "Guard.tsx",
        `import { useState } from "react";

export function LeaveGuard({ isDirty }: { isDirty: boolean }) {
  const [proceededFor, setProceededFor] = useState<boolean | undefined>(undefined);
  const shouldBlock = isDirty && proceededFor !== isDirty;
  const handleProceed = () => {
    setProceededFor(isDirty);
  };
  return <button onClick={handleProceed}>{shouldBlock ? "Leave anyway" : "Leave"}</button>;
}
`,
      ),
      1,
    );
  });

  it("uses the prop directly, or starts over with a `key` and no effect", () => {
    compilesAndIsSilent(
      wholeFile(
        "Badge.tsx",
        `export function Badge({ label }: { label: string }) {
  return <b>{label}</b>;
}

export function Page({ title }: { title: string }) {
  return <Badge label={title} />;
}
`,
      ),
      1,
    );
    compilesAndIsSilent(
      wholeFile(
        "Note.tsx",
        `import { useState } from "react";

export function Note({ body }: { body: string }) {
  const [draft, setDraft] = useState(body);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

export function NotePage({ id, body }: { id: string; body: string }) {
  return <Note key={id} body={body} />;
}
`,
      ),
      1,
    );
  });
});
