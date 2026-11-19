import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWith, fixture, ways } from "./brand-helpers.js";

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
      [
        "`SocketId` is built without its check",
        ways("build it in `./socket.js`, its owner", "SocketId", "sockets.ts"),
      ],
      [
        "`SocketId` is built without its check",
        ways("build it in `./socket.js`, its owner", "SocketId", "sockets.ts"),
      ],
      [
        "`isSocketId` says a value is `SocketId` without its check",
        ways("build it in `./socket.js`, its owner", "SocketId", "sockets.ts"),
      ],
    ]);
  });

  it("the `owners` line of the hint is the option as written, with the real path, and the import as the file writes it", () => {
    const [found] = checkWith(dir, "brand-built-outside-owner", {}).filter((finding) =>
      finding.location.file.endsWith("sub/deep.ts"),
    );
    expect(found?.hint).toBe(
      ways(
        "build it with `userId()` from `../ids.js`, and handle the `undefined` it returns",
        "UserId",
        "sub/deep.ts",
      ),
    );
    // Not the file's name in the hint, and not the import without its ending as the file has it.
    expect(found?.hint).not.toContain("../ids.ts");
    expect(found?.hint).not.toMatch(/option for `UserId`(\n|$)/);
    // Written as shown, the finding is gone: the key is the brand's name, the value the file.
    const line = /\{ owners: (\{.*\}) \}/.exec(found?.hint ?? "")?.[1];
    const owners: unknown = JSON.parse(line ?? "null");
    expect(owners).toEqual({ UserId: ["sub/deep.ts"] });
    expect(
      files(dir, "brand-built-outside-owner", { owners: { UserId: ["sub/deep.ts"] } }),
    ).not.toContain("deep.ts");
    expect(files(dir, "brand-built-outside-owner", {})).toContain("deep.ts");
  });

  it("`predicates: false` leaves type predicates alone", () => {
    expect(files(dir, "brand-built-outside-owner", {})).toContain("predicates.ts");
    expect(files(dir, "brand-built-outside-owner", { predicates: false })).not.toContain(
      "predicates.ts",
    );
  });
});
