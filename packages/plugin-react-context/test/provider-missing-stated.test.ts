import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding, Location } from "@stateward/core";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

/** The Provider-value rule reads the same fixtures; its findings are tested in provider-value.test.ts. */
const PROVIDER_RULES_ONLY = { "react-context/provider-value-changes-every-render": "off" } as const;

const SLOW = 300_000;
const FIXTURES = fileURLToPath(new URL("./fixtures/provider-missing", import.meta.url));

function where(location: Location, dir: string): string {
  const line = readFileSync(location.file, "utf8").slice(0, location.start).split("\n").length;
  return `${path.relative(dir, location.file).split(path.sep).join("/")}:${String(line)}`;
}

function show(finding: Finding, dir: string): string[] {
  const head = `${finding.kind === "problem" ? finding.severity : "not checked"} ${where(finding.location, dir)}: ${finding.message}`;
  const notes =
    finding.kind === "problem"
      ? finding.related.map((note) => `note ${where(note.location, dir)}: ${note.message}`)
      : [];
  return [head, `fix: ${finding.hint}`, ...notes];
}

function run(name: string, addons: readonly string[] = []): string[][] {
  const dir = path.join(FIXTURES, name);
  const { findings } = checkFixture(dir, [reactContext()], PROVIDER_RULES_ONLY, addons);
  expectMessageStandard(findings);
  return findings.map((finding) => show(finding, dir));
}

const STATED = (file: string, context: string): string =>
  `note ${file}: \`${context}\` is stated required: every reader must be proven under its Provider`;

const missing = (site: string, tag: string, context: string): string[] => [
  `error ${site}: \`<${tag}>\` is rendered without \`${context}.Provider\``,
  `fix: one of\n- wrap it in \`<${context}.Provider value={…}>\`\n- or render it inside a component that provides \`${context}\``,
];

describe("react-context/provider-missing: a context stated required", () => {
  it(
    "proves readers through useContext, use, a Consumer and a hook, and offers to drop the hook's check",
    { timeout: SLOW },
    () => {
      expect(run("stated-proven")).toEqual([
        [
          "info src/useTheme.ts:6: `useTheme` checks `ThemeCtx` at run time, but every reader is proven under its Provider",
          "fix: remove the check: `ThemeCtx` is stated required, so its value is always there",
        ],
      ]);
    },
  );

  it(
    "reports a missing Provider as an error with the path and the declaration that states it",
    { timeout: SLOW },
    () => {
      // Readers need no check: the unchecked `use` read is followed. The hook keeps its check,
      // since the proof does not hold.
      expect(run("stated-missing")).toEqual([
        [
          ...missing("src/main.tsx:20", "Page", "ThemeCtx"),
          "note src/main.tsx:8: `<WithUse>` is rendered",
          "note src/Readers.tsx:10: `WithUse` reads `ThemeCtx`",
          STATED("src/contexts.ts:5", "ThemeCtx"),
        ],
      ]);
    },
  );

  it(
    "makes a component picked at run time an error, with the path to it and how to make it provable",
    { timeout: SLOW },
    () => {
      expect(run("stated-dynamic")).toEqual([
        [
          "error src/Panels.tsx:4: `Settings` reads `ThemeCtx` (stated required), but no entry point renders it",
          "fix: one of\n- render it from the app, under the Provider\n- or list it in `entries` in the react-context options",
          STATED("src/contexts.ts:5", "ThemeCtx"),
        ],
        [
          "error src/Panels.tsx:16: `ThemeCtx` (stated required) is not proven: the component behind `<Panel>` cannot be followed",
          "fix: one of\n- render the component directly; constant maps are checked by the dynamic-components add-on\n- or pass the value to the component as a prop instead of through the context",
          "note src/main.tsx:8: `<App>` is rendered",
          "note src/main.tsx:5: `<Dashboard>` is rendered",
          STATED("src/contexts.ts:5", "ThemeCtx"),
        ],
      ]);
    },
  );

  it(
    "proves a component picked at run time under the Provider, and what it may render",
    { timeout: SLOW },
    () => {
      expect(run("stated-dynamic-provided")).toEqual([]);
    },
  );

  it(
    "recognises the marker through a local generic alias and a renamed re-export, with no helper",
    { timeout: SLOW },
    () => {
      expect(run("stated-recognition")).toEqual([
        [
          "error src/main.tsx:5: `Unreached` reads `AuthCtx` (stated required), but no entry point renders it",
          "fix: one of\n- render it from the app, under the Provider\n- or list it in `entries` in the react-context options",
          STATED("src/contexts.ts:9", "AuthCtx"),
        ],
        [
          ...missing("src/main.tsx:14", "Profile", "AuthCtx"),
          "note src/Profile.tsx:5: `Profile` reads `AuthCtx`",
          STATED("src/contexts.ts:9", "AuthCtx"),
        ],
      ]);
    },
  );

  it(
    "proves a context stated in another package of a monorepo, instead of leaving it not checked",
    { timeout: SLOW },
    () => {
      expect(run("stated-package")).toEqual([
        [
          ...missing("src/main.tsx:10", "Toolbar", "ThemeCtx"),
          "note src/Toolbar.tsx:5: `Toolbar` reads `ThemeCtx`",
          STATED("../../acme-ui/src/index.ts:7", "ThemeCtx"),
        ],
      ]);
    },
  );

  it("is an error, never a silent pass, when it finds no entry point", { timeout: SLOW }, () => {
    expect(run("stated-no-entry")).toEqual([
      [
        "error src/contexts.ts:5: `ThemeCtx` (stated required) cannot be proven: no entry point is found",
        "fix: one of\n- render the app with `createRoot(…).render(<App/>)`\n- or list the entry point in `entries` in the react-context options",
        STATED("src/contexts.ts:5", "ThemeCtx"),
      ],
    ]);
  });
});
