import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFixture } from "../src/testing.js";
import { literalProbe, plugin } from "./probe-plugin.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-literals-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(sources: Record<string, string>, order = Object.keys(sources)): string[] {
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        types: [],
      },
      files: order,
    }),
  );
  for (const [name, text] of Object.entries(sources)) writeFileSync(path.join(dir, name), text);
  return checkFixture(dir, [plugin({ literals: literalProbe })]).findings.map((f) => f.message);
}

describe("TypeQueries.literalsOf", () => {
  it("sorts a union by label, whatever TypeScript checked first", () => {
    const sources = {
      "a.ts": 'export const first = ["x", "y", "z"];\n',
      "b.ts": 'export declare const probeUnion: "z" | "y" | "x";\n',
    };
    const expected = ['probeUnion: "x","y","z"'];
    expect(project(sources, ["a.ts", "b.ts"])).toEqual(expected);
    expect(project(sources, ["b.ts", "a.ts"])).toEqual(expected);
  });

  it("lists enum members by their qualified name", () => {
    expect(
      project({
        "a.ts": [
          "export enum Color { Red = 'r', Blue = 'b' }",
          "export enum Level { Low = 1, High = 2 }",
          "export declare const probeColor: Color;",
          "export declare const probeLevel: Level;",
          "export declare const probeOne: Color.Red;",
        ].join("\n"),
      }),
    ).toEqual([
      "probeColor: Color.Blue,Color.Red",
      "probeLevel: Level.High,Level.Low",
      "probeOne: Color.Red",
    ]);
  });

  it("treats boolean as true and false", () => {
    expect(project({ "a.ts": "export declare const probeFlag: boolean;\n" })).toEqual([
      "probeFlag: false,true",
    ]);
  });

  it("includes null and undefined", () => {
    expect(
      project({ "a.ts": 'export declare const probeMaybe: "a" | null | undefined;\n' }),
    ).toEqual(['probeMaybe: "a",null,undefined']);
  });

  it("widens a type parameter to its constraint", () => {
    expect(
      project({
        "a.ts": 'export function f<T extends "b" | "a">(probeArg: T): T { return probeArg; }\n',
      }),
    ).toEqual(['probeArg: "a","b"']);
  });

  it("gives up on types that are not finite", () => {
    expect(
      project({
        "a.ts": [
          "export declare const probeText: string;",
          "export declare const probeMixed: 1 | string;",
          "export function f<T>(probeAny: T): T { return probeAny; }",
        ].join("\n"),
      }),
    ).toEqual(["probeText: not-finite", "probeMixed: not-finite", "probeAny: not-finite"]);
  });
});
