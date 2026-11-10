import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createChecker,
  parseConfig,
  type PackageFactsConfig,
  type RuleConfig,
} from "@stateward/core";
import { describeStatus, proveGuarantees } from "@stateward/core/internal";
import { asyncFlow } from "../src/index.js";
import { check, fixture, shown } from "./helpers.js";

const DIR = fixture("pending-trait");
const OFF = { "async/handler-rejection-lost": "off" } as const;

const TWICE = (fn: string, state: string, running: string) => ({
  message: `\`${fn}\` starts again while \`${state}\` is \`${running}\``,
  hint: [
    "one of",
    `- return early while it runs, read from a ref (state read in a handler can be one render old): \`if (${state}Ref.current) return;\``,
    `- or disable the control while it runs: \`disabled={${state}}\``,
  ].join("\n"),
});

describe("async/pending-state-stuck-on-failure: a state stated `Pending`", () => {
  const found = shown(check(DIR, OFF));

  it("proves it settles on every way out and does not start twice, with fixes named from the type", () => {
    expect(found.filter((finding) => finding.file === "save.ts")).toEqual([
      {
        file: "save.ts",
        name: "setSaving(true)",
        ...TWICE("save", "saving", "true"),
        notes: ["`saving` is stated `Pending` here"],
        fix: undefined,
      },
      {
        file: "save.ts",
        name: "setSaving(true)",
        // Any `await` may fail: `post` is declared with no body, yet the state says it must settle.
        message: "`saving` stays `true` when `post(…)` fails",
        hint: "set `saving` back in `finally`: `finally { setSaving(false); }`",
        notes: ["`saving` is stated `Pending` here"],
        fix: "Reset the state in a finally",
      },
      {
        file: "save.ts",
        name: 'this.status = "saving"',
        message: '`status` stays `"saving"` when `post(…)` fails',
        // The start value in `finally`; each other value that is not running in a `catch`.
        hint: [
          "one of",
          '- set `status` back in `finally`: `finally { this.status = "idle"; }`',
          '- or set it to "failed" in a `catch`: `catch (error) { this.status = "failed"; throw error; }`',
        ].join("\n"),
        notes: ["`status` is stated `Pending` here"],
        fix: undefined,
      },
      {
        file: "save.ts",
        name: "setBusy(true)",
        message: "`busy` stays `true` after `start` returns",
        hint: "set `busy` back in `finally`: `finally { setBusy(false); }`",
        notes: ["`busy` is stated `Pending` here"],
        fix: undefined,
      },
      {
        file: "save.ts",
        name: "Pending<Status>",
        message: "`Pending<Status>` names no running value",
        hint: 'say which values of `Status` mean running: `Pending<Status, "…">`',
        notes: ["`Pending<Status>` is stated here"],
        fix: undefined,
      },
    ]);
  });

  it("is silent when it settles in `finally` and a ref guards the start, or the function never awaits", () => {
    expect(found.filter((finding) => finding.file === "clean.ts")).toEqual([]);
  });
});

describe("async: the states it lists as stated `Pending`", () => {
  it("lists each with its running values and the places that start it", () => {
    const parsed = parseConfig({ plugins: [asyncFlow()], preset: "recommended", rules: OFF }, DIR);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: DIR, cache: false });
    const result = checker.check();
    const listed = proveGuarantees(
      checker.guarantees(),
      result.findings,
      new Set(["async/pending-state-stuck-on-failure"]),
    ).map((proof) => `${proof.stated.name}: ${describeStatus(proof)} — ${proof.stated.promise}`);
    const promise = (state: string, running: string) =>
      `\`${state}\` is running while ${running}; every way out of a function that sets it leaves another value, and that function does not start while it is ${running}`;
    expect(listed).toEqual([
      // clean.ts: settled in `finally`, guarded by a ref; and set back with no `await`.
      `saving: proven for 1 function that sets it — ${promise("saving", "`true`")}`,
      `saving: proven for 1 function that sets it — ${promise("saving", "`true`")}`,
      // save.ts
      `saving: not proven: 2 errors — ${promise("saving", "`true`")}`,
      `status: not proven: 1 error — ${promise("status", '`"saving"`')}`,
      `busy: not proven: 1 error — ${promise("busy", "`true`")}`,
      "status: not proven: 1 error — nothing yet: no value of `status` is stated running",
    ]);
  });
});

describe("async/pending-state-stuck-on-failure: how severe a stated finding is", () => {
  const RULE = "async/pending-state-stuck-on-failure";
  const severities = (rules: Record<string, RuleConfig>) =>
    check(DIR, { ...OFF, ...rules })
      .filter((finding) => finding.ruleId === RULE)
      .map((finding) => (finding.kind === "problem" ? finding.severity : "unknown"));

  it("is an error for a state stated `Pending`, though the rule's shape-based findings are warnings", () => {
    expect(severities({})).toEqual(["error", "error", "error", "error", "error"]);
  });

  it("follows the severity the config gives the kind `stated`", () => {
    expect(severities({ [RULE]: ["warning", { severities: { stated: "warning" } }] })).toEqual([
      "warning",
      "warning",
      "warning",
      "warning",
      "warning",
    ]);
  });
});

describe("async/pending-state-stuck-on-failure: a promise the facts say never rejects", () => {
  const RULE = "async/pending-state-stuck-on-failure";
  let dir = "";

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), "stateward-pending-facts-")));
    for (const file of ["guarantees.ts", "react.ts", "tsconfig.json"]) {
      cpSync(path.join(DIR, file), path.join(dir, file));
    }
    mkdirSync(path.join(dir, "node_modules", "queue"), { recursive: true });
    writeFileSync(
      path.join(dir, "node_modules", "queue", "package.json"),
      JSON.stringify({ name: "queue", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(
      path.join(dir, "node_modules", "queue", "index.d.ts"),
      "export declare function drained(): Promise<void>;\n",
    );
    writeFileSync(
      path.join(dir, "drain.ts"),
      [
        'import { drained } from "queue";',
        'import type { Pending } from "./guarantees.js";',
        'import { useState } from "./react.js";',
        "",
        "export function useDrain() {",
        "  const [draining, setDraining] = useState<Pending<boolean>>(false);",
        "  const drainingRef = { current: false };",
        "  async function drain(): Promise<void> {",
        "    if (drainingRef.current) return;",
        "    drainingRef.current = true;",
        "    setDraining(true);",
        "    await drained();",
        "    setDraining(false);",
        "    drainingRef.current = false;",
        "  }",
        "  return { draining, drain };",
        "}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const messages = (facts: PackageFactsConfig) => {
    const parsed = parseConfig(
      { plugins: [asyncFlow()], preset: "recommended", rules: OFF, facts },
      dir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    return checker
      .check()
      .findings.filter((finding) => finding.ruleId === RULE)
      .map((finding) => finding.message);
  };

  it("does not count an `await` of it as a way out, and counts any other", () => {
    expect(messages({ queue: { drained: { neverRejects: true } } })).toEqual([]);
    expect(messages({})).toEqual(["`draining` stays `true` when `drained()` fails"]);
  });
});
