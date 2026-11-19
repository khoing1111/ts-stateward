import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

const DIR = fileURLToPath(new URL("./fixtures/provider-value/stable-reads", import.meta.url));
const OLD = "dependencies that never change";

const { findings } = checkFixture(DIR, [reactContext()], {});
expectMessageStandard(findings);
const reports = findings
  .filter((one) => one.ruleId === "react-context/provider-value-changes-every-render")
  .map((one) => ({ message: one.message, hint: one.hint }));
const ALTERNATIVE = (context: string): string =>
  `- or remove \`Stable\` from the type of \`${context}\`, if its value is meant to change`;

describe("a context stated Stable: the memo's dependency list must cover what it reads", () => {
  it("a literal that reads state names it, and no longer offers a memo over it", () => {
    expect(reports[0]).toEqual({
      message: "`SessionContext` is stated `Stable`, but its value is a new object every render",
      hint: [
        "one of",
        "- keep `user` (state) out of this value and give it to readers through another context",
        ALTERNATIVE("SessionContext"),
      ].join("\n"),
    });
    expect(reports[0]?.hint).not.toContain(OLD);
  });

  it("`useMemo(() => ({ user, setUser }), [setUser])` is not proven: `user` is read but not listed", () => {
    expect(reports[1]).toEqual({
      message:
        "`SessionContext` is stated `Stable`, but its value is not proven stable: `user` is read in the `useMemo` but not in its dependencies",
      hint: [
        "one of",
        "- keep `user` (state) out of this value and give it to readers through another context (in the dependency list, it would make the value change)",
        ALTERNATIVE("SessionContext"),
      ].join("\n"),
    });
  });

  it("the same for `useCallback` reading a prop", () => {
    expect(reports[2]?.message).toBe(
      "`ActionContext` is stated `Stable`, but its value is not proven stable: `label` is read in the `useCallback` but not in its dependencies",
    );
    expect(reports[2]?.hint).toContain("keep `label` (a prop) out of this value");
  });

  it("a listed dependency is the existing finding, and a memo over a setter only is proven", () => {
    expect(reports.map((one) => one.message.slice(one.message.indexOf("but its value")))).toEqual([
      "but its value is a new object every render",
      "but its value is not proven stable: `user` is read in the `useMemo` but not in its dependencies",
      "but its value is not proven stable: `label` is read in the `useCallback` but not in its dependencies",
      "but its value changes when `user` changes",
    ]);
  });
});
