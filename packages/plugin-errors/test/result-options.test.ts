import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWith, fixture } from "./helpers.js";

/*
 * Each option of `errors/result-ignored`, shown changing what it reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

const count = (...args: Parameters<typeof checkWith>): number => checkWith(...args).length;
const files = (...args: Parameters<typeof checkWith>): string[] =>
  checkWith(...args).map((finding) => path.basename(finding.location.file));

describe("errors/result-ignored options", () => {
  const dir = fixture("result-ignored/flagged");
  it("`allowVoid` takes `void call()` as dropping it on purpose", () => {
    const all = count(dir, "result-ignored", ["error", {}]);
    expect(count(dir, "result-ignored", ["error", { allowVoid: true }])).toBe(all - 3);
  });

  it("`ignore` leaves out the functions named", () => {
    const all = count(dir, "result-ignored", ["error", {}]);
    expect(count(dir, "result-ignored", ["error", { ignore: ["repo.save", "ok"] }])).toBe(all - 2);
  });

  it("`resultTypes` names a Result whose shape is not recognised", () => {
    expect(files(dir, "result-ignored", ["error", {}])).not.toContain("either.ts");
    expect(
      files(dir, "result-ignored", ["error", { resultTypes: ["Either"] }]).filter(
        (file) => file === "either.ts",
      ),
    ).toHaveLength(1);
  });
});
