import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, TextEdit } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

const RULE = "react/effect-response-race";
const LATEST = fixture("latest-wins");
const ADDON = ["react/effect-race"];

/** The rule's findings over the fixture, on as in the presets (an error), with the add-ons given. */
const race = (addons: readonly string[] = []): Shown[] =>
  shown(LATEST, check(LATEST, { [RULE]: "error" }, [react()], addons)).filter(
    (finding) => finding.rule === RULE,
  );

const passHint = (call: string, passed: string): string =>
  [
    `create a controller in the effect, pass its signal to \`${call}\`, and abort it in the cleanup:`,
    "    const controller = new AbortController();",
    `    ${passed}`,
    "    return () => controller.abort();",
  ].join("\n");

const STALE = "state is set from the answer";

/** What the proof reports in Missing.tsx: one error per missing step. */
const missing: Shown[] = [
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "fetchUser(userId)",
    message:
      "`fetchUser(…)` takes an AbortSignal the effect never passes: an answer for an old `userId` can overwrite a newer one",
    hint: passHint("fetchUser(…)", "fetchUser(…, controller.signal)"),
    notes: [`Missing.tsx: setUser: ${STALE}`],
    fixes: [
      "Missing.tsx@278: const controller = new AbortController();\n     | Missing.tsx@294: , controller.signal | Missing.tsx@310: \n    return () => controller.abort();",
    ],
  },
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: 'fetch(url, { cache: "no-store" })',
    message:
      "`fetch(…)` takes an AbortSignal the effect never passes: an answer for an old `url` can overwrite a newer one",
    hint: passHint("fetch(…)", "fetch(…, { signal: controller.signal })"),
    notes: [`Missing.tsx: setText(await response.text()): ${STALE}`],
    fixes: [
      "Missing.tsx@568: const controller = new AbortController();\n     | Missing.tsx@707: , signal: controller.signal | Missing.tsx@798: controller.abort();\n      ",
    ],
  },
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "searchUsers(query, { signal: controller.signal })",
    message:
      "effect never aborts `controller` in its cleanup: an answer for an old `query` can overwrite a newer one",
    hint: "abort it when the effect is cleaned up: `return () => controller.abort();`",
    notes: [`Missing.tsx: setUsers: ${STALE}`],
    fixes: ["Missing.tsx@1174: \n    return () => controller.abort();"],
  },
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "fetchUser(userId, controller.current.signal)",
    message:
      "`fetchUser(…)` gets a signal the effect does not abort: an answer for an old `userId` can overwrite a newer one",
    hint: passHint("fetchUser(…)", "fetchUser(…, controller.signal)"),
    notes: [`Missing.tsx: setUser: ${STALE}`],
    fixes: [],
  },
  // A flag the cleanup sets proves nothing when the write does not check it.
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "fetchUser(userId)",
    message:
      "`fetchUser(…)` takes an AbortSignal the effect never passes: an answer for an old `userId` can overwrite a newer one",
    hint: passHint("fetchUser(…)", "fetchUser(…, controller.signal)"),
    notes: [`Missing.tsx: setUser: ${STALE}`],
    fixes: [
      "Missing.tsx@1834: const controller = new AbortController();\n     | Missing.tsx@1874: , controller.signal | Missing.tsx@1916: controller.abort();\n      ",
    ],
  },
  // A function of the component that sets state, called without the signal it takes.
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "load()",
    message:
      "`load(…)` takes an AbortSignal the effect never passes: an answer for an old `userId` can overwrite a newer one",
    hint: passHint("load(…)", "load(controller.signal)"),
    notes: [],
    fixes: [
      "Missing.tsx@2300: const controller = new AbortController();\n     | Missing.tsx@2310: controller.signal | Missing.tsx@2312: \n    return () => controller.abort();",
    ],
  },
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "fetchUser(userId, controller.signal)",
    message: "`fetchUser(…)` is not proven aborted: the cleanup is not written in the effect",
    hint: "return the cleanup as a function written in the effect, so it can be checked: `return () => controller.abort();`",
    notes: [`Missing.tsx: setUser: ${STALE}`],
    fixes: [],
  },
  // A flag tested when the request starts, not when the answer arrives, proves nothing.
  {
    rule: RULE,
    severity: "error",
    file: "Missing.tsx",
    at: "fetchUser(userId)",
    message:
      "`fetchUser(…)` takes an AbortSignal the effect never passes: an answer for an old `userId` can overwrite a newer one",
    hint: passHint("fetchUser(…)", "fetchUser(…, controller.signal)"),
    notes: [`Missing.tsx: setUser(loaded): ${STALE}`],
    fixes: [
      "Missing.tsx@2961: const controller = new AbortController();\n     | Missing.tsx@3022: , controller.signal | Missing.tsx@3090: controller.abort();\n      ",
    ],
  },
];

const guessHint = (setter: string): string =>
  `ignore a response that arrives after the effect is cleaned up:\n    let ignore = false;\n    … if (!ignore) ${setter}(…);\n    return () => { ignore = true; };`;

/** What the add-on guesses in Guessed.tsx, about calls that take no signal. */
const guessed: Shown[] = [
  {
    rule: RULE,
    severity: "warning",
    file: "Guessed.tsx",
    at: "setUser(await loadUser(userId))",
    message: "response race: an answer for an old `userId` can overwrite a newer one",
    hint: guessHint("setUser"),
    notes: ["Guessed.tsx: loadUser(userId): the request that can answer late"],
    fixes: [],
  },
  {
    rule: RULE,
    severity: "warning",
    file: "Guessed.tsx",
    at: "setUser(loaded)",
    message: "response race: an answer for an old `id` can overwrite a newer one",
    hint: guessHint("setUser"),
    notes: ["Guessed.tsx: loadUser(id): the request that can answer late"],
    fixes: [],
  },
];

describe("react/effect-response-race: a loader that takes an AbortSignal (latest wins)", () => {
  it("proves each cancellable form and the stale flag, and reports each missing step as an error", () => {
    // Proven.tsx: a controller's signal in options, as a parameter, destructured, in an options
    // object written first, a library's own signal type, a signal received by a function of the
    // effect or of the component, the React docs' flag, a flag that starts true, a once-only effect.
    expect(race()).toEqual(missing);
  });

  it("guesses about calls that take no signal only with the add-on, and only the narrow case", () => {
    // Not guessed: local state in the dependencies, a `.then` on a call that takes no signal.
    expect(race(ADDON)).toEqual([...guessed, ...missing]);
  });

  it("is an error under the recommended preset, without the add-on", () => {
    const findings = check(LATEST, {}, [react()], []).filter((finding) => finding.ruleId === RULE);
    expect(findings).toHaveLength(missing.length);
    expect(
      findings.every((finding) => finding.kind === "problem" && finding.severity === "error"),
    ).toBe(true);
  });
});

const SLOW = 300_000;
/** Under the package, so the copy resolves React from the package's own node_modules. */
const SCRATCH = fileURLToPath(new URL("../.scratch/latest-wins", import.meta.url));

describe("react/effect-response-race: the quick fix", () => {
  let dir = "";

  beforeEach(() => {
    mkdirSync(SCRATCH, { recursive: true });
    dir = mkdtempSync(path.join(SCRATCH, "app-"));
    cpSync(LATEST, dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function reviewed(): Finding[] {
    const parsed = parseConfig({ preset: "recommended", plugins: [react()] }, dir);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    return checker
      .reviewFixes(checker.check().findings)
      .map((review) => review.finding)
      .filter((finding) => finding.ruleId === RULE);
  }

  function apply(edits: readonly TextEdit[]): void {
    const file = path.join(dir, "Missing.tsx");
    const text = [...edits]
      .sort((a, b) => b.location.start - a.location.start)
      .reduce(
        (result, edit) =>
          result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
        readFileSync(file, "utf8"),
      );
    writeFileSync(file, text);
  }

  it(
    "adds the controller, passes its signal and aborts it in the cleanup; it compiles and is proven",
    { timeout: SLOW },
    () => {
      const before = reviewed();
      const fixes = before.flatMap((finding) =>
        finding.kind === "problem" ? finding.fixes.slice(0, 1) : [],
      );
      // Every fix offered compiled when tried; the foreign signal and the unreadable cleanup get none.
      expect(fixes.map((fix) => fix.title)).toEqual([
        "Abort fetchUser(…) when the effect is cleaned up",
        "Abort fetch(…) when the effect is cleaned up",
        "Abort searchUsers(…) when the effect is cleaned up",
        "Abort fetchUser(…) when the effect is cleaned up",
        "Abort load(…) when the effect is cleaned up",
        "Abort fetchUser(…) when the effect is cleaned up",
      ]);
      apply(fixes.flatMap((fix) => fix.edits));
      const text = readFileSync(path.join(dir, "Missing.tsx"), "utf8");
      expect(text).toContain(
        [
          "  useEffect(() => {",
          "    const controller = new AbortController();",
          "    fetchUser(userId, controller.signal).then(setUser);",
          "    return () => controller.abort();",
          "  }, [userId]);",
        ].join("\n"),
      );
      expect(text).toContain('await fetch(url, { cache: "no-store", signal: controller.signal });');
      expect(text).toContain(
        ["    return () => {", "      controller.abort();", "      clearInterval(timer);"].join(
          "\n",
        ),
      );
      expect(text).toContain("void load(controller.signal);");
      expect(typeErrors(dir)).toBe("");
      expect(
        reviewed().map((finding) =>
          readFileSync(finding.location.file, "utf8").slice(
            finding.location.start,
            finding.location.end,
          ),
        ),
      ).toEqual([
        "fetchUser(userId, controller.current.signal)",
        "fetchUser(userId, controller.signal)",
      ]);
    },
  );
});
