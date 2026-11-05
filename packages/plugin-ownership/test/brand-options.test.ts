import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWith, fixture } from "./brand-helpers.js";

/*
 * Each option of `ownership/brand-built-outside-owner`, shown changing what it reports. The
 * default of every option is today's behaviour, which the rule's own tests cover.
 */

const files = (...args: Parameters<typeof checkWith>): string[] =>
  checkWith(...args).map((finding) => path.basename(finding.location.file));

describe("ownership/brand-built-outside-owner options", () => {
  const dir = fixture("brand-built-outside-owner/flagged");
  it("`owners` lets more files build a brand", () => {
    const all = files(dir, "brand-built-outside-owner", {});
    expect(all).toContain("users.ts");
    const owned = files(dir, "brand-built-outside-owner", { owners: { UserId: ["**/users.ts"] } });
    expect(owned.length).toBeLessThan(all.length);
  });

  it("`owners` makes a brand with no exported check owned: building it elsewhere is reported", () => {
    const unowned = fixture("brand-built-outside-owner/not-flagged");
    expect(files(unowned, "brand-built-outside-owner", {})).toEqual([]);
    const findings = checkWith(unowned, "brand-built-outside-owner", {
      owners: { SocketId: ["**/socket.ts"] },
    });
    expect(findings.map((finding) => [finding.message, finding.hint])).toEqual([
      ["`SocketId` is built here without its check", "build it in `./socket.ts`, its owner"],
      ["`SocketId` is built here without its check", "build it in `./socket.ts`, its owner"],
      [
        "`isSocketId` says a value is `SocketId` without its check",
        "build it in `./socket.ts`, its owner",
      ],
    ]);
  });

  it("`predicates: false` leaves type predicates alone", () => {
    expect(files(dir, "brand-built-outside-owner", {})).toContain("predicates.ts");
    expect(files(dir, "brand-built-outside-owner", { predicates: false })).not.toContain(
      "predicates.ts",
    );
  });
});
