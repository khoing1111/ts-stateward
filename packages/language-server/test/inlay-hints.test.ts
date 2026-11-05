import { describe, expect, it } from "vitest";
import { hintEnabled, readHintSettings } from "../src/inlay-hints.js";

describe("hint settings", () => {
  it("leaves every kind on without settings", () => {
    for (const settings of [undefined, null, {}, { inlayHints: 1 }]) {
      expect(hintEnabled(readHintSettings(settings), "throws")).toBe(true);
    }
  });

  it("turns off a kind set to false, and only that one", () => {
    const settings = readHintSettings({
      inlayHints: { throws: false, catchVariable: true, other: "no" },
    });
    expect(hintEnabled(settings, "throws")).toBe(false);
    expect(hintEnabled(settings, "catchVariable")).toBe(true);
    expect(hintEnabled(settings, "other")).toBe(true);
  });
});
