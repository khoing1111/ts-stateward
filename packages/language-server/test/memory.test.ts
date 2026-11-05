import { afterEach, describe, expect, it, vi } from "vitest";

const setFlagsFromString = vi.fn<(flags: string) => void>();
vi.mock("node:v8", () => ({ default: { setFlagsFromString } }));

const { HEAP_GROWING_PERCENT, limitHeapGrowth } = await import("../src/memory.js");

afterEach(() => {
  setFlagsFromString.mockClear();
});

describe("the server's heap growth", () => {
  it("tells V8 to collect once the heap grew 10% past what the last collection kept", () => {
    limitHeapGrowth();
    expect(HEAP_GROWING_PERCENT).toBe(10);
    expect(setFlagsFromString.mock.calls).toEqual([["--heap-growing-percent=10"]]);
  });
});
