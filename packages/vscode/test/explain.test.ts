import { describe, expect, it } from "vitest";
import { explainPath, ruleIdFromArgument } from "../src/explain.js";

describe("the explain command", () => {
  it("takes the rule id from the first argument, and nothing else", () => {
    expect(ruleIdFromArgument("records/table-type-too-loose")).toBe("records/table-type-too-loose");
    expect(ruleIdFromArgument("")).toBeUndefined();
    expect(ruleIdFromArgument(undefined)).toBeUndefined();
    expect(ruleIdFromArgument({ ruleId: "x" })).toBeUndefined();
  });

  it("names the document after the rule, as Markdown", () => {
    expect(explainPath("react-context/fake-default-value")).toBe(
      "/react-context/fake-default-value.md",
    );
  });
});
