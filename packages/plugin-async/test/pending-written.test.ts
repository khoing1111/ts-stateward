import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { asyncFlow } from "../src/index.js";
import { fixture } from "./helpers.js";

const DIR = fixture("pending-written");

describe("async: a state is listed as stated `Pending` only where the marker is written", () => {
  it("lists a type argument and an annotation, not a value copied from a stated one", () => {
    const parsed = parseConfig({ plugins: [asyncFlow()], preset: "recommended" }, DIR);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: DIR, cache: false });
    checker.check();
    expect(checker.guarantees().map((stated) => stated.name)).toEqual(["isSubmitting", "busy"]);
  });
});
