import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";

/*
 * The finding samples in the user guides are what `stateward check` prints, not what it once
 * printed: each one is the output of a small project in `fixtures/docs-samples/`, checked here.
 * A sample the guides add needs a project here (a line below), and a change to a message that a
 * sample shows fails this test until the guide shows the new text. The release notes
 * (`beta-*`, `rc-*`, `whats-new`) say what a release printed and are left alone.
 */

const GUIDES = fileURLToPath(new URL("../../../docs/user", import.meta.url));
const SAMPLES = fileURLToPath(new URL("fixtures/docs-samples", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../../../examples", import.meta.url));

/** The project that prints each sample of a guide, by the guide and the rule of the finding. */
const PROJECTS: Readonly<Record<string, string>> = {
  "quick-start.md unions/non-exhaustive-switch": path.join(SAMPLES, "quick-start"),
  "pre-commit.md unions/non-exhaustive-switch": path.join(SAMPLES, "pre-commit"),
  "guarantees.md react-context/provider-missing": path.join(SAMPLES, "required-context"),
  "guarantees.md ownership/state-written-outside-owner": path.join(SAMPLES, "owned"),
  "guarantees.md ownership/brand-built-outside-owner": path.join(SAMPLES, "opaque"),
  "guarantees.md ownership/resource-not-released": path.join(SAMPLES, "release"),
  "guarantees.md async/pending-state-stuck-on-failure": path.join(SAMPLES, "pending"),
  "guarantees.md unions/non-exhaustive-switch": path.join(SAMPLES, "open-union"),
  "guarantees.md react/effect-response-race": path.join(SAMPLES, "latest-wins"),
  "write-your-own-rule.md team/max-union-members": path.join(EXAMPLES, "basic"),
};

const RELEASE_NOTES = /^(?:beta-\d+|rc-\d+|whats-new)\.md$/;
const START = /^(?:error|warning|info)\[([^\]]+)\]: /;

/** The finding blocks of a guide: each from its headline to its `= docs:` line. */
export function samplesOf(text: string): { rule: string; block: string }[] {
  const lines = text.split("\n");
  const found: { rule: string; block: string }[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const rule = START.exec(lines[at] ?? "")?.[1];
    if (rule === undefined) continue;
    const end = lines.findIndex((line, index) => index > at && /^\s*= docs:/.test(line));
    found.push({ rule, block: lines.slice(at, end === -1 ? at + 1 : end + 1).join("\n") });
  }
  return found;
}

/** The blocks `stateward check` prints for a project, as the guides show them (no colour). */
async function printed(cwd: string): Promise<string[]> {
  let stdout = "";
  await main(["check"], {
    cwd,
    stdout: (t) => (stdout += t),
    stderr: () => undefined,
    color: false,
  });
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const line of stdout.split("\n")) {
    if (START.test(line)) current = [line];
    else if (current !== undefined) current.push(line);
    if (current !== undefined && /^\s*= docs:/.test(line)) {
      blocks.push(current.join("\n"));
      current = undefined;
    }
  }
  return blocks;
}

const guides = readdirSync(GUIDES).filter(
  (file) => file.endsWith(".md") && !RELEASE_NOTES.test(file),
);

describe("the finding samples in docs/user", { timeout: 60_000 }, () => {
  for (const guide of guides) {
    const samples = samplesOf(readFileSync(path.join(GUIDES, guide), "utf8"));
    for (const sample of samples) {
      it(`${guide}: ${sample.rule} is what the CLI prints`, async () => {
        const project = PROJECTS[`${guide} ${sample.rule}`];
        expect(project, `no project prints the ${sample.rule} sample of ${guide}`).toBeDefined();
        const blocks = await printed(project ?? "");
        expect(blocks).toContain(sample.block);
      });
    }
  }

  it("has a project for every sample, and none that no guide shows", () => {
    const shown = guides.flatMap((guide) =>
      samplesOf(readFileSync(path.join(GUIDES, guide), "utf8")).map(
        (sample) => `${guide} ${sample.rule}`,
      ),
    );
    expect([...new Set(shown)].sort()).toEqual(Object.keys(PROJECTS).sort());
  });
});
