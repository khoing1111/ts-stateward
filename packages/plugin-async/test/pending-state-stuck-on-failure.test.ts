import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { check as checkProject, parseConfig } from "@stateward/core";
import type { Finding, PackageFactsConfig } from "@stateward/core";
import { checkFixture, ruleCode } from "@stateward/core/testing";
import { asyncFlow } from "../src/index.js";
import {
  applied,
  check,
  checkWithPreset,
  fixture,
  shown,
  typeErrors,
  withFixesApplied,
} from "./helpers.js";

const FLAGGED = fixture("pending-state-stuck-on-failure/flagged");
const NOT_FLAGGED = fixture("pending-state-stuck-on-failure/not-flagged");
const OFF = { "async/handler-rejection-lost": "off" } as const;

/** `call` is what fails; `reset` is the code that goes in the `finally`. */
function leak(name: string, call: string, flag: string, reset: string, fix?: string) {
  // `search` is shown `search()`; a call with arguments is passed as `api.fetchAll(…)`.
  call = call.endsWith(")") ? call : `${call}()`;
  return {
    file: "save.ts",
    name,
    message: `\`${flag}\` stays \`true\` when \`${call}\` fails`,
    hint: `set \`${flag}\` again in a \`finally\`, so a failure resets it too: \`try { await ${call}; } finally { ${reset} }\``,
    notes: [],
    fix,
  };
}

/** A state set again to a value only success makes true: the failure needs its own write. */
function stuck(name: string, call: string, state: string, value: string, write: string) {
  call = call.endsWith(")") ? call : `${call}()`;
  return {
    file: "save.ts",
    name,
    message: `\`${state}\` stays \`${value}\` when \`${call}\` fails`,
    hint: `set \`${state}\` in a \`catch\` too, so a failure resets it: \`try { await ${call}; … } catch (error) { ${write} throw error; }\``,
    notes: [],
    fix: undefined,
  };
}

const FIX = "Reset the state in a finally";

describe("async/pending-state-stuck-on-failure", () => {
  it("names what fails and the state, whatever it is called, and shows the finally or catch", () => {
    const findings = check(FLAGGED, OFF);
    expect(shown(findings)).toEqual([
      leak("setLoading(true)", "search", "loading", "setLoading(false);", FIX),
      leak("this.isSaving = true", "submit", "isSaving", "this.isSaving = false;", FIX),
      {
        ...leak(
          "state.pending = true",
          "api.fetchAll(…)",
          "pending",
          "state.pending = false;",
          FIX,
        ),
        // The function also writes the data: the note points at one status union.
        notes: [
          "`pending` and `items` are written together here: one status union holds them without contradictions",
        ],
      },
      leak("setSubmitting(true)", "submit", "submitting", "setSubmitting(false);", FIX),
      leak("setBusy(true)", "search", "busy", "setBusy(false);"),
      leak("setLoading(true)", "search", "loading", "setLoading(false);"),
      leak("setLoading(true)", "search", "loading", "setLoading(false);", FIX),
      // No word list: the shape is what counts.
      stuck(
        'setState({ status: "loading" })',
        "search",
        "state",
        '{ status: "loading" }',
        "setState(…);",
      ),
      leak("setWaiting(true)", "search", "waiting", "setWaiting(false);", FIX),
      stuck('setStatus("saving")', "submit", "status", '"saving"', "setStatus(…);"),
      leak("setLoading(true)", "untaggedSearch", "loading", "setLoading(false);", FIX),
      // A `.catch` callback that rethrows without setting the state.
      leak("setWaiting(true)", "search().catch(…)", "waiting", "setWaiting(false);", FIX),
      // A `.finally` that sets the running value again.
      leak("setWaiting(true)", "search().finally(…)", "waiting", "setWaiting(false);", FIX),
    ]);
  });

  it("reads a class component's `setState` with an object written in place, not a computed state", () => {
    const findings = check(fixture("pending-state-stuck-on-failure/class-state"), OFF).filter(
      (finding) => finding.ruleId === "async/pending-state-stuck-on-failure",
    );
    expect(findings.map((finding) => finding.message)).toEqual([
      "`state` stays `{ saving: true }` when `fetch(…)` fails",
    ]);
  });

  it("is a warning, never an error, under every preset (a heuristic rule)", () => {
    const rule = ruleCode(asyncFlow(), "pending-state-stuck-on-failure");
    expect(rule.meta.tier).toBe("core");
    expect(rule.meta.group).toBe("failures");
    expect(rule.meta.heuristic).toBe(true);
    expect(rule.meta.defaultSeverity).toBe("warning");
    for (const preset of ["recommended", "strict"] as const) {
      const ours = checkWithPreset(FLAGGED, preset).filter(
        (finding) => finding.ruleId === "async/pending-state-stuck-on-failure",
      );
      expect(ours).toHaveLength(13);
      expect(
        ours.every((finding) => finding.kind === "problem" && finding.severity === "warning"),
      ).toBe(true);
    }
  });

  it("wraps the plain shape in try/finally, and the result compiles", () => {
    const findings = check(FLAGGED, OFF);
    const file = path.join(FLAGGED, "save.ts");
    const [first] = findings;
    const edits = first?.kind === "problem" ? (first.fixes[0]?.edits ?? []) : [];
    const text = readFileSync(file, "utf8");
    expect(applied(text, edits)).toContain(
      [
        "  setLoading(true);",
        "  try {",
        "    await search();",
        "  } finally {",
        "    setLoading(false);",
        "  }",
      ].join("\n"),
    );
    withFixesApplied(FLAGGED, findings, (fixed) => {
      expect(typeErrors(fixed)).toBe("");
      const after = readFileSync(path.join(fixed, "save.ts"), "utf8");
      expect(after).toContain(
        [
          "    try {",
          "      await submit();",
          "    } finally {",
          "      this.isSaving = false;",
        ].join("\n"),
      );
      expect(
        check(fixed, OFF).filter(
          (finding) => finding.ruleId === "async/pending-state-stuck-on-failure",
        ),
      ).toHaveLength(4);
    });
  });

  it("offers no quick fix when a try, a catch or a chain is already there, or success sets a value", () => {
    const withoutFix = check(FLAGGED, OFF).filter(
      (finding) => finding.kind === "problem" && finding.fixes.length === 0,
    );
    expect(withoutFix).toHaveLength(4);
  });

  it("reports nothing for a finally, a catch that resets, no await, a local, a result that arrives, or a wrapper that catches and returns null", () => {
    expect(shown(check(NOT_FLAGGED, OFF))).toEqual([]);
  });

  it("explains itself, and points at one union instead of a flag", () => {
    const explain = ruleCode(asyncFlow(), "pending-state-stuck-on-failure").meta.explain;
    expect(explain).toContain("# async/pending-state-stuck-on-failure");
    expect(explain).toContain("example-bad");
    expect(explain).toContain("example-good");
    expect(explain).toContain("### One state for an async result");
    expect(explain).toContain("One union holds them without contradictions");
    expect(explain).toContain('rules: { "async/pending-state-stuck-on-failure": "off" }');
  });

  it("reports nothing once switched off", () => {
    const { findings } = checkFixture(FLAGGED, [asyncFlow()], {
      "async/pending-state-stuck-on-failure": "off",
      "async/handler-rejection-lost": "off",
    });
    expect(findings).toEqual([]);
  });
});

describe("async/pending-state-stuck-on-failure: a call that cannot fail, said in facts", () => {
  /** A project that sets a flag around a package's `send`, checked with `facts`. */
  function withFacts(facts: PackageFactsConfig): readonly Finding[] {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-async-pending-facts-"));
    try {
      writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext" },
          include: ["*.ts"],
        }),
      );
      const lib = path.join(dir, "node_modules", "quiet-client");
      mkdirSync(lib, { recursive: true });
      writeFileSync(
        path.join(lib, "package.json"),
        '{ "name": "quiet-client", "version": "1.0.0", "types": "index.d.ts" }\n',
      );
      writeFileSync(
        path.join(lib, "index.d.ts"),
        "export declare function send(message: string): Promise<boolean>;\n",
      );
      writeFileSync(
        path.join(dir, "app.ts"),
        [
          'import { send } from "quiet-client";',
          "",
          "declare function setSending(value: boolean): void;",
          "",
          "export async function onSend(): Promise<void> {",
          "  setSending(true);",
          '  await send("hi");',
          "  setSending(false);",
          "}",
          "",
        ].join("\n"),
      );
      const rules = { "async/pending-state-stuck-on-failure": "warning" as const };
      const parsed = parseConfig({ plugins: [asyncFlow()], rules, facts }, dir);
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      return checkProject({ config: parsed.value, cwd: dir }).findings.filter(
        (finding) => finding.ruleId === "async/pending-state-stuck-on-failure",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("takes `rejects: []` to mean the package function never rejects", () => {
    expect(
      withFacts({ "quiet-client": { send: { rejects: ["Error"] } } }).map((f) => f.message),
    ).toEqual(["`sending` stays `true` when `send(…)` fails"]);
    expect(withFacts({ "quiet-client": { send: { rejects: [] } } })).toEqual([]);
  });
});
