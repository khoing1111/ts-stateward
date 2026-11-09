import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { ownership } from "../src/index.js";
import { fixture } from "./helpers.js";

const RULE = "ownership/resource-not-released";

/**
 * Projects with no `Release` marker: the rule then asks no type question about a call whose
 * syntax rules the trait out. Each way of reaching a function with a `facts` line must still be
 * kept: its own name, a rename with `as` (also through a module of the project), a `const` that
 * renames it or destructures it under another name, a namespace, and a default import. A `[Symbol.dispose]` member of the project keeps every call.
 */
const FILES: Record<string, string> = {
  "src/direct.ts": [
    'import { doc, onSnapshot } from "firebase/firestore";',
    "export function direct(): void {",
    '  const unsubscribe = onSnapshot(doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/renamed.ts": [
    'import { doc, onSnapshot as listen } from "firebase/firestore";',
    "export function renamed(): void {",
    '  const unsubscribe = listen(doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/db.ts": 'export { doc, onSnapshot as watch } from "firebase/firestore";',
  "src/wrapped.ts": [
    'import { doc, watch } from "./db";',
    "export function wrapped(): void {",
    '  const unsubscribe = watch(doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/namespace.ts": [
    'import * as firestore from "firebase/firestore";',
    "export function namespaced(): void {",
    '  const unsubscribe = firestore.onSnapshot(firestore.doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/aliased.ts": [
    'import { doc, onSnapshot } from "firebase/firestore";',
    "const listen = onSnapshot;",
    "export function aliased(): void {",
    '  const unsubscribe = listen(doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/destructured.ts": [
    'import * as firestore from "firebase/firestore";',
    "const { onSnapshot: follow, doc } = firestore;",
    "export function destructured(): void {",
    '  const unsubscribe = follow(doc("a"), () => undefined);',
    "  void unsubscribe;",
    "}",
  ].join("\n"),
  "src/fallback.ts": [
    'import listenTo from "listener";',
    "export function defaulted(): void {",
    "  const stop = listenTo(() => undefined);",
    "  void stop;",
    "}",
  ].join("\n"),
};

const DISPOSABLE: Record<string, string> = {
  "src/connection.ts": [
    "export class Connection {",
    "  [Symbol.dispose](): void {}",
    "}",
    "export function open(): Connection {",
    "  return new Connection();",
    "}",
    "export function leak(): void {",
    "  const connection = open();",
    "  void connection;",
    "}",
  ].join("\n"),
};

function project(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "stateward-candidates-")));
  const source = fixture("resource-not-released");
  cpSync(path.join(source, "tsconfig.json"), path.join(dir, "tsconfig.json"));
  cpSync(path.join(source, "packages"), path.join(dir, "node_modules"), { recursive: true });
  mkdirSync(path.join(dir, "node_modules", "listener"), { recursive: true });
  writeFileSync(
    path.join(dir, "node_modules", "listener", "package.json"),
    JSON.stringify({ name: "listener", version: "1.0.0", types: "index.d.ts" }),
  );
  writeFileSync(
    path.join(dir, "node_modules", "listener", "index.d.ts"),
    "export default function listen(handler: () => void): () => void;\n",
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  for (const [file, text] of Object.entries(files))
    writeFileSync(path.join(dir, file), `${text}\n`);
  return dir;
}

function messages(dir: string): string[] {
  const parsed = parseConfig(
    {
      plugins: [ownership()],
      preset: "recommended",
      rules: {
        "ownership/state-written-outside-owner": "off",
        "ownership/brand-built-outside-owner": "off",
      },
      facts: { listener: { listen: { returns: "release" } } },
    },
    dir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
  return checker
    .check()
    .findings.filter((finding) => finding.ruleId === RULE)
    .map((finding) => `${path.relative(dir, finding.location.file)}: ${finding.message}`);
}

describe(
  "ownership/resource-not-released: calls ruled out by their syntax",
  { timeout: 60_000 },
  () => {
    let facts = "";
    let disposable = "";

    beforeAll(() => {
      facts = project(FILES);
      disposable = project(DISPOSABLE);
    });

    afterAll(() => {
      rmSync(facts, { recursive: true, force: true });
      rmSync(disposable, { recursive: true, force: true });
    });

    it("compiles", () => {
      expect(typeErrors(facts)).toBe("");
      expect(typeErrors(disposable)).toBe("");
    });

    it("keeps every call that reaches a function with a `facts` line, however it is named", () => {
      expect(messages(facts)).toEqual([
        "src/aliased.ts: `unsubscribe` from `listen(…)` is never released",
        "src/destructured.ts: `unsubscribe` from `follow(…)` is never released",
        "src/direct.ts: `unsubscribe` from `onSnapshot(…)` is never released",
        "src/fallback.ts: `stop` from `listenTo(…)` is never released",
        "src/namespace.ts: `unsubscribe` from `firestore.onSnapshot(…)` is never released",
        "src/renamed.ts: `unsubscribe` from `listen(…)` is never released",
        "src/wrapped.ts: `unsubscribe` from `watch(…)` is never released",
      ]);
    });

    it("keeps every call when the project declares a `[Symbol.dispose]` member", () => {
      expect(messages(disposable)).toEqual([
        "src/connection.ts: `connection` from `open(…)` is never released",
      ]);
    });
  },
);
