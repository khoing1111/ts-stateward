import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Checker, RuleSetting } from "@stateward/core";
import { errors } from "../src/index.js";
import { fixture } from "./helpers.js";

const DIR = fixture("inlay-hints");

function checker(rules: Record<string, RuleSetting> = {}): Checker {
  const parsed = parseConfig({ preset: "recommended", plugins: [errors()], rules }, DIR);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return createChecker({ config: parsed.value, cwd: DIR });
}

const solved = checker();
solved.check();

/** The file's lines with each enabled hint written in `⟦ ⟧` where the editor draws it. */
function drawn(target: Checker, file: string, enabled?: (kind: string) => boolean): string[] {
  const full = path.join(DIR, file);
  const text = readFileSync(full, "utf8");
  const hints = [...target.inlayHints(full, enabled)].sort((a, b) => b.offset - a.offset);
  const withHints = hints.reduce(
    (result, hint) =>
      `${result.slice(0, hint.offset)}⟦${hint.paddingLeft === true ? " " : ""}${hint.label}⟧${result.slice(hint.offset)}`,
    text,
  );
  return withHints.split("\n").filter((line) => line.includes("⟦"));
}

describe("errors: inline hints after a signature", () => {
  it("shows throws after a function, a method, an arrow bound to a const, and an async function, and names where unknown errors come from", () => {
    expect(drawn(solved, "functions.ts")).toEqual([
      "export function plain(id: string)⟦ throws ParseError⟧ {",
      "export function annotated(id: string): string⟦ throws ParseError⟧ {",
      "  find(id: string): string⟦ throws AuthError | ParseError⟧ {",
      "export const arrow = (id: string)⟦ throws ParseError⟧ => {",
      "export async function load(id: string): Promise<string>⟦ rejects RateLimitError⟧ {",
      "export function many(kind: number): void⟦ throws AuthError | ConflictError | ParseError | +2⟧ {",
      // What stateward cannot see is named by the call it comes from, never a bare "others".
      "export function unsure(): void⟦ throws (unknown from `external.run`)⟧ {",
      "export function mixed(kind: number): void⟦ throws QuotaError | (unknown from `external.run`)⟧ {",
      "export function several(): void⟦ throws (unknown from `external.run`, +1)⟧ {",
    ]);
  });

  it("says nothing for a function that throws nothing stateward can see", () => {
    expect(drawn(solved, "functions.ts").join("\n")).not.toContain("nothing()");
  });

  it("has the hover's facts as its tooltip", () => {
    const full = path.join(DIR, "functions.ts");
    const hint = solved
      .inlayHints(full)
      .find((one) => one.label === "throws AuthError | ParseError");
    expect(hint?.tooltip).toBe("throws: AuthError | ParseError");
  });

  it("is off when the kind is turned off", () => {
    expect(drawn(solved, "functions.ts", (kind) => kind !== "throws")).toEqual([]);
  });

  it("is empty when the inference rules did not run", () => {
    const off = checker({
      "errors/catch-misses-error": "off",
      "errors/throws-doc-mismatch": "off",
      // The React rules solve the same facts, so the hints read them too.
      "errors/render-throw-without-boundary": "off",
    });
    off.check();
    expect(drawn(off, "functions.ts")).toEqual([]);
  });
});

describe("errors: inline hints after a catch variable", () => {
  it("lists the classes the try can throw, and unknown when part is unknown", () => {
    expect(drawn(solved, "catches.ts")).toEqual([
      "  } catch (e⟦: AuthError | ParseError⟧) {",
      "  } catch (error⟦: ParseError | unknown⟧) {",
    ]);
  });

  it("is off when the kind is turned off", () => {
    expect(drawn(solved, "catches.ts", (kind) => kind !== "catchVariable")).toEqual([]);
  });

  it("explains where the classes come from", () => {
    const full = path.join(DIR, "catches.ts");
    const hint = solved.inlayHints(full).find((one) => one.kind === "catchVariable");
    expect(hint?.tooltip).toBe("The `try` can throw: AuthError | ParseError");
  });
});
