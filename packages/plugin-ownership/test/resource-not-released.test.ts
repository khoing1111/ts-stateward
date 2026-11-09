import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectMessageStandard, typeErrors } from "@stateward/core/testing";
import type { Finding, PackageFactsConfig } from "@stateward/core";
import { createChecker, parseConfig } from "@stateward/core";
import { describeStatus, proveGuarantees } from "@stateward/core/internal";
import { ownership } from "../src/index.js";
import { fixture } from "./helpers.js";

const RULE = "ownership/resource-not-released";
const OFF = {
  "ownership/state-written-outside-owner": "off",
  "ownership/brand-built-outside-owner": "off",
} as const;

/**
 * The fixture with its packages in node_modules (git keeps no node_modules folder): RxJS, Redux,
 * zustand and Firestore, each declared with only the types the fixture calls.
 */
let dir = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "stateward-release-")));
  const source = fixture("resource-not-released");
  cpSync(path.join(source, "src"), path.join(dir, "src"), { recursive: true });
  cpSync(path.join(source, "tsconfig.json"), path.join(dir, "tsconfig.json"));
  cpSync(path.join(source, "packages"), path.join(dir, "node_modules"), { recursive: true });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Shown = { at: string; message: string; hint: string; notes: string[] };

function shown(findings: readonly Finding[]): Shown[] {
  return findings
    .filter((finding) => finding.ruleId === RULE)
    .map((finding) => ({
      at: path.relative(dir, finding.location.file),
      message: finding.message,
      hint: finding.hint,
      notes: finding.kind === "problem" ? finding.related.map((note) => note.message) : [],
    }));
}

function check(facts: PackageFactsConfig = {}): readonly Finding[] {
  const parsed = parseConfig(
    { plugins: [ownership()], preset: "recommended", rules: OFF, facts },
    dir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
  const { findings } = checker.check();
  expectMessageStandard(findings);
  return findings;
}

const PRICES = "`watchPrices` returns a release function (its return type is stated `Release`)";
const STATED = "`watchPrices` is stated `Release` here";
const NEVER = (name: string) =>
  `one of\n- call \`${name}()\` when it is no longer needed\n- or return it, so the caller releases it\n- or, if it lives as long as the app, say so on the line above: \`// stateward-ignore ownership/resource-not-released: lives as long as the app\``;

describe(RULE, { timeout: 60_000 }, () => {
  it("compiles", () => {
    expect(typeErrors(dir)).toBe("");
  });

  it("reports each value with the release trait that is not released, with where the trait comes from", () => {
    expect(shown(check()).filter((finding) => finding.at === "src/flagged.ts")).toEqual([
      {
        at: "src/flagged.ts",
        message: "the result of `watchPrices(…)` is never released",
        hint: "one of\n- keep it (`const release = watchPrices(…)`) and call `release()` when it is no longer needed\n- or return it, so the caller releases it\n- or, if it lives as long as the app, say so on the line above: `// stateward-ignore ownership/resource-not-released: lives as long as the app`",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message: "`stop` from `watchPrices(…)` is never released",
        hint: NEVER("stop"),
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message: "`stop` from `watchPrices(…)` is not released on every way out",
        hint: "one of\n- release it in `finally`: `try { … } finally { stop(); }`\n- or return it, so the caller releases it",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message: "`stop` from `watchPrices(…)` is not released on every way out",
        hint: "one of\n- release it in `finally`: `try { … } finally { stop(); }`\n- or return it, so the caller releases it",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message:
          "`stop` from `watchPrices(…)` is passed to `register()`, whose parameter is not typed `Release`",
        hint: "one of\n- type the parameter of `register` `Release`, so its function releases it\n- or release it here: `stop()`",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message:
          "`stop` from `watchPrices(…)` is stored in an array, where its release cannot be followed",
        hint: "keep it in a variable and release it: `stop()`",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message:
          "the result of `watchPrices(…)` is stored in `this.stop`, which the file never releases",
        hint: "one of\n- release it where it is stored: `this.stop()`\n- or state `this.stop` `Owned`, so its module releases it",
        notes: [PRICES, STATED],
      },
      {
        at: "src/flagged.ts",
        message: "`subscription` from `interval(1000).subscribe(…)` is never released",
        hint: NEVER("subscription.unsubscribe"),
        notes: [
          "`Observable.subscribe` returns a value released with `unsubscribe()` (stateward's facts for rxjs)",
        ],
      },
      {
        at: "src/flagged.ts",
        message: "`unsubscribe` from `store.subscribe(…)` is never released",
        hint: NEVER("unsubscribe"),
        notes: ["`Store.subscribe` returns a release function (stateward's facts for redux)"],
      },
      {
        at: "src/flagged.ts",
        message:
          "the result of `createVanilla(() => ({ count: 0 })).subscribe(…)` is never released",
        hint: "one of\n- keep it (`const release = createVanilla(() => ({ count: 0 })).subscribe(…)`) and call `release()` when it is no longer needed\n- or return it, so the caller releases it\n- or, if it lives as long as the app, say so on the line above: `// stateward-ignore ownership/resource-not-released: lives as long as the app`",
        notes: ["`StoreApi.subscribe` returns a release function (stateward's facts for zustand)"],
      },
      {
        at: "src/flagged.ts",
        message: "`unsubscribe` from `onSnapshot(…)` is never released",
        hint: NEVER("unsubscribe"),
        notes: [
          "`onSnapshot` returns a release function (stateward's facts for firebase/firestore)",
        ],
      },
      {
        at: "src/flagged.ts",
        message: "`unsubscribe` from `onSnapshot(…)` is not released on every way out",
        hint: "one of\n- release it in `finally`: `try { … } finally { unsubscribe(); }`\n- or return it, so the caller releases it",
        notes: [
          "`onSnapshot` returns a release function (stateward's facts for firebase/firestore)",
        ],
      },
      {
        at: "src/flagged.ts",
        message: "`connection` from `open(…)` is never released",
        hint: "one of\n- declare it with `using`, so it is released on every way out:\n    using connection = open(…);\n- or return it, so the caller releases it\n- or, if it lives as long as the app, say so on the line above: `// stateward-ignore ownership/resource-not-released: lives as long as the app`",
        notes: [
          "`open` returns a value released with `using` or `[Symbol.dispose]()` (its type, `Disposable`)",
        ],
      },
    ]);
  });

  it("is silent on values released, returned, handed to a `Release` parameter or started at the top of a module", () => {
    expect(shown(check()).filter((finding) => finding.at !== "src/flagged.ts")).toEqual([]);
  });

  it("reads the config's facts before the shipped ones, and says so", () => {
    const facts = { rxjs: { "Observable.subscribe": { returns: "release" as const } } };
    const rx = shown(check(facts)).find((finding) => finding.message.includes("interval"));
    expect(rx?.hint).toBe(NEVER("subscription"));
    expect(rx?.notes).toEqual([
      "`Observable.subscribe` returns a release function (the config's facts for rxjs)",
    ]);
  });

  it("reads `neverRejects` facts: an `await` of RTK Query's `cacheEntryRemoved` is not a way out", () => {
    const streaming = (findings: readonly Finding[]) =>
      shown(findings).filter(
        (finding) =>
          finding.message === "`unsubscribe` from `onSnapshot(…)` is not released on every way out",
      );
    // Shipped: only the release after `await cacheDataLoaded` (which can reject) is reported.
    expect(streaming(check())).toHaveLength(1);
    // A config line for the same property wins over the shipped one, and drops `neverRejects`.
    const facts = { "@reduxjs/toolkit": { cacheEntryRemoved: {} } };
    expect(streaming(check(facts))).toHaveLength(2);
    expect(
      streaming(check({ "@reduxjs/toolkit": { cacheDataLoaded: { neverRejects: true } } })),
    ).toEqual([]);
  });

  it("lists the release trait of each source in use with `stateward guarantees`", () => {
    const parsed = parseConfig({ plugins: [ownership()], preset: "recommended", rules: OFF }, dir);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
    const result = checker.check();
    const listed = proveGuarantees(checker.guarantees(), result.findings, new Set([RULE]))
      .filter((proof) => proof.stated.ruleId === RULE)
      .map(
        (proof) =>
          `${proof.stated.name} ${proof.stated.marker} (${proof.stated.source?.kind ?? ""}): ${describeStatus(proof)}`,
      );
    expect(listed).toEqual([
      // clean.ts: each released
      "open(…) Disposable (type): proven for 1 call",
      "Observable.subscribe(…) Observable.subscribe (shipped): proven for 1 call",
      "onSnapshot(…) onSnapshot (shipped): proven for 1 call",
      // clean.ts: RTK Query's streaming pattern
      "onSnapshot(…) onSnapshot (shipped): proven for 1 call",
      // clean.ts: stored in a field and returned
      "Observable.subscribe(…) Observable.subscribe (shipped): proven for 1 call",
      // connection.ts: returned by `open`
      "new Connection(…) Disposable (type): proven for 1 call",
      // flagged.ts
      "Observable.subscribe(…) Observable.subscribe (shipped): not proven: 1 error",
      "Store.subscribe(…) Store.subscribe (shipped): not proven: 1 error",
      "StoreApi.subscribe(…) StoreApi.subscribe (shipped): not proven: 1 error",
      "onSnapshot(…) onSnapshot (shipped): not proven: 1 error",
      "onSnapshot(…) onSnapshot (shipped): not proven: 1 error",
      "open(…) Disposable (type): not proven: 1 error",
      // prices.ts: the marker, with the seven calls in flagged.ts that do not release it
      "watchPrices Release (marker): not proven: 7 errors",
    ]);
  });
});
