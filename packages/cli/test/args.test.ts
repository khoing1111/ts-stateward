import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("parses check with defaults", () => {
    expect(parseArgs(["check"])).toEqual({
      ok: true,
      value: {
        kind: "check",
        format: "pretty",
        formatGiven: false,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
        cwd: undefined,
        max: undefined,
      },
    });
  });

  it("parses --verify-fixes with --format json only", () => {
    expect(parseArgs(["check", "--format", "json", "--verify-fixes"])).toMatchObject({
      ok: true,
      value: { kind: "check", verifyFixes: true },
    });
    expect(parseArgs(["check", "--verify-fixes"])).toMatchObject({ ok: false });
  });

  it("parses --no-cache for check only", () => {
    expect(parseArgs(["check", "--no-cache"])).toEqual({
      ok: true,
      value: {
        kind: "check",
        format: "pretty",
        formatGiven: false,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
        cwd: undefined,
        max: undefined,
        noCache: true,
      },
    });
    expect(parseArgs(["plan", "--no-cache"])).toEqual({
      ok: false,
      errors: ["--no-cache only applies to check"],
    });
  });

  it("parses the baseline command and its flags", () => {
    expect(parseArgs(["baseline", "--prune"])).toEqual({
      ok: true,
      value: { kind: "baseline", prune: true, cwd: undefined },
    });
    expect(parseArgs(["baseline"])).toEqual({
      ok: true,
      value: { kind: "baseline", prune: false, cwd: undefined },
    });
    expect(parseArgs(["check", "--no-baseline"])).toMatchObject({
      ok: true,
      value: { kind: "check", noBaseline: true },
    });
    expect(parseArgs(["next", "--baseline"])).toMatchObject({
      ok: true,
      value: { kind: "next", baseline: true, anyway: false },
    });
    expect(parseArgs(["plan", "--no-baseline"])).toEqual({
      ok: false,
      errors: ["--no-baseline only applies to check"],
    });
    expect(parseArgs(["check", "--prune"])).toEqual({
      ok: false,
      errors: ["--prune only applies to baseline"],
    });
    expect(parseArgs(["check", "--baseline"])).toEqual({
      ok: false,
      errors: ["--baseline only applies to next"],
    });
  });

  it("parses check options in any order", () => {
    const expected = {
      ok: true,
      value: {
        kind: "check",
        format: "json",
        formatGiven: true,
        cwd: "app",
        max: undefined,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
      },
    };
    expect(parseArgs(["check", "--format", "json", "--cwd", "app"])).toEqual(expected);
    expect(parseArgs(["check", "--cwd", "app", "--format", "json"])).toEqual(expected);
  });

  it("parses --max for pretty check output only", () => {
    expect(parseArgs(["check", "--max", "10"])).toEqual({
      ok: true,
      value: {
        kind: "check",
        format: "pretty",
        formatGiven: false,
        cwd: undefined,
        max: 10,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
      },
    });
    for (const bad of ["0", "-1", "ten", "1.5"]) {
      expect(parseArgs(["check", "--max", bad])).toEqual({
        ok: false,
        errors: [`--max must be a whole number above 0, not "${bad}"`],
      });
    }
    const onlyPretty = {
      ok: false,
      errors: ["--max only applies to check with the pretty format"],
    };
    expect(parseArgs(["check", "--format", "json", "--max", "3"])).toEqual(onlyPretty);
    expect(parseArgs(["coverage", "--max", "3"])).toEqual(onlyPretty);
  });

  it("parses coverage like check", () => {
    expect(parseArgs(["coverage"])).toEqual({
      ok: true,
      value: { kind: "coverage", format: "pretty", cwd: undefined },
    });
    expect(parseArgs(["coverage", "--format", "json", "--cwd", "app"])).toEqual({
      ok: true,
      value: { kind: "coverage", format: "json", cwd: "app" },
    });
  });

  it("accepts every pack in --packs", () => {
    expect(parseArgs(["init", "--packs", "async,records,unions,react-context"])).toEqual({
      ok: true,
      value: {
        kind: "init",
        cwd: undefined,
        packs: ["async", "records", "unions", "react-context"],
        preset: undefined,
        yes: false,
        changed: false,
        hook: undefined,
        force: false,
      },
    });
  });

  it("parses --yes for init only", () => {
    expect(parseArgs(["init", "--yes"])).toEqual({
      ok: true,
      value: {
        kind: "init",
        cwd: undefined,
        packs: undefined,
        preset: undefined,
        yes: true,
        changed: false,
        hook: undefined,
        force: false,
      },
    });
    expect(parseArgs(["check", "--yes"])).toEqual({
      ok: false,
      errors: ["--yes only applies to init"],
    });
  });

  it("parses init with and without --packs and --preset", () => {
    expect(parseArgs(["init", "--cwd", "x"])).toEqual({
      ok: true,
      value: {
        kind: "init",
        cwd: "x",
        packs: undefined,
        preset: undefined,
        yes: false,
        changed: false,
        hook: undefined,
        force: false,
      },
    });
    expect(
      parseArgs(["init", "--packs", "react-context,unions,unions", "--preset", "strict"]),
    ).toEqual({
      ok: true,
      value: {
        kind: "init",
        cwd: undefined,
        packs: ["react-context", "unions"],
        preset: "strict",
        yes: false,
        changed: false,
        hook: undefined,
        force: false,
      },
    });
  });

  it("parses deps and cache", () => {
    expect(parseArgs(["deps", "--format", "json"])).toEqual({
      ok: true,
      value: { kind: "deps", format: "json", cwd: undefined },
    });
    expect(parseArgs(["cache", "clean"])).toEqual({
      ok: true,
      value: { kind: "cache", action: "clean", cwd: undefined },
    });
    expect(parseArgs(["cache"])).toEqual({
      ok: false,
      errors: ['cache needs "stats" (show its size) or "clean" (delete it)'],
    });
  });

  it("parses guarantees", () => {
    expect(parseArgs(["guarantees", "--format", "json"])).toEqual({
      ok: true,
      value: { kind: "guarantees", format: "json", cwd: undefined },
    });
    expect(parseArgs(["guarantees", "x"])).toEqual({
      ok: false,
      errors: ['guarantees takes no arguments, got "x"'],
    });
  });

  it("parses explain", () => {
    expect(parseArgs(["explain", "a/b"])).toEqual({
      ok: true,
      value: { kind: "explain", ruleId: "a/b", cwd: undefined },
    });
  });

  it.each([
    [[], "give a command, e.g. stateward check"],
    [["frobnicate"], 'unknown command "frobnicate"'],
    [["check", "--nope"], "unknown option --nope"],
    [["check", "--format"], "--format needs a value"],
    [["check", "--cwd"], "--cwd needs a value"],
    [["check", "--format", "xml"], '--format must be "pretty", "json" or "github", not "xml"'],
    [["check", "extra"], 'check takes no arguments, got "extra"'],
    [["init", "extra"], 'init takes no arguments, got "extra"'],
    [["coverage", "extra"], 'coverage takes no arguments, got "extra"'],
    [
      ["init", "--format", "json"],
      "--format only applies to check, coverage, plan, deps and guarantees",
    ],
    [
      ["init", "--packs", "unions,nope"],
      '--packs: unknown pack "nope"; known packs: unions, records, async, react-context, errors, ownership, reducers, react',
    ],
    [
      ["init", "--packs", ""],
      '--packs: unknown pack ""; known packs: unions, records, async, react-context, errors, ownership, reducers, react',
    ],
    [["init", "--preset", "loud"], '--preset must be "recommended" or "strict", not "loud"'],
    [["check", "--packs", "unions"], "--packs only applies to init"],
    [["coverage", "--preset", "strict"], "--preset only applies to init"],
    [["plan", "extra"], 'plan takes no arguments, got "extra"'],
    [["next", "extra"], 'next takes no arguments, got "extra"'],
    [
      ["next", "--format", "json"],
      "--format only applies to check, coverage, plan, deps and guarantees",
    ],
    [["check", "--rule"], "--rule needs a value"],
    [["plan", "--rule", "a/b"], "--rule only applies to check"],
    [["check", "--anyway"], "--anyway only applies to next"],
    [["plan", "--max", "3"], "--max only applies to check with the pretty format"],
    [["explain"], "explain needs one rule, e.g. stateward explain records/lookup-misses-key"],
    [
      ["explain", "a", "b"],
      "explain needs one rule, e.g. stateward explain records/lookup-misses-key",
    ],
  ])("rejects %j", (argv, error) => {
    expect(parseArgs(argv)).toEqual({ ok: false, errors: [error] });
  });

  it("parses check --rule, alone and with --max", () => {
    expect(parseArgs(["check", "--rule", "guards/a", "--max", "2"])).toEqual({
      ok: true,
      value: {
        kind: "check",
        format: "pretty",
        formatGiven: false,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
        cwd: undefined,
        max: 2,
        rule: "guards/a",
      },
    });
  });

  it("parses check --group, alone and with --max, and not with --rule", () => {
    expect(parseArgs(["check", "--group", "guards/switches", "--max", "2"])).toEqual({
      ok: true,
      value: {
        kind: "check",
        format: "pretty",
        formatGiven: false,
        fix: false,
        dryRun: false,
        timing: false,
        verifyFixes: false,
        cwd: undefined,
        max: 2,
        rule: undefined,
        group: "guards/switches",
      },
    });
    expect(parseArgs(["check", "--rule", "guards/a", "--group", "guards/switches"])).toEqual({
      ok: false,
      errors: ["use --rule or --group, not both"],
    });
    expect(parseArgs(["check", "--group"])).toEqual({
      ok: false,
      errors: ["--group needs a value"],
    });
    expect(parseArgs(["plan", "--group", "a/b"])).toEqual({
      ok: false,
      errors: ["--group only applies to check"],
    });
  });

  it("parses plan with a format, and next with --anyway", () => {
    expect(parseArgs(["plan", "--format", "json", "--cwd", "app"])).toEqual({
      ok: true,
      value: { kind: "plan", format: "json", cwd: "app" },
    });
    expect(parseArgs(["next"])).toEqual({
      ok: true,
      value: { kind: "next", anyway: false, baseline: false, cwd: undefined },
    });
    expect(parseArgs(["next", "--anyway"])).toEqual({
      ok: true,
      value: { kind: "next", anyway: true, baseline: false, cwd: undefined },
    });
  });

  it("parses --timing for check only, and not with --fix", () => {
    expect(parseArgs(["check", "--timing"])).toMatchObject({
      ok: true,
      value: { kind: "check", timing: true },
    });
    expect(parseArgs(["plan", "--timing"])).toEqual({
      ok: false,
      errors: ["--timing only applies to check"],
    });
    expect(parseArgs(["check", "--timing", "--fix"])).toEqual({
      ok: false,
      errors: ["--timing does not apply with --fix"],
    });
  });

  it("parses --fix and --dry-run for check only, and --dry-run only with --fix", () => {
    expect(parseArgs(["check", "--fix", "--dry-run"])).toMatchObject({
      ok: true,
      value: { kind: "check", fix: true, dryRun: true },
    });
    expect(parseArgs(["check", "--fix"])).toMatchObject({
      ok: true,
      value: { fix: true, dryRun: false },
    });
    expect(parseArgs(["check", "--dry-run"])).toMatchObject({ ok: false });
    expect(parseArgs(["plan", "--fix"])).toMatchObject({ ok: false });
    expect(parseArgs(["check", "--fix", "--format", "json"])).toMatchObject({ ok: false });
  });
});
