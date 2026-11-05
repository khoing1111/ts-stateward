import { describe, expect, it } from "vitest";
import { SILENT_PROGRESS, withProgress, type ProgressReporter } from "../src/progress.js";

function recorder(): { events: string[]; open: () => Promise<ProgressReporter> } {
  const events: string[] = [];
  return {
    events,
    open: () =>
      Promise.resolve({
        begin: (title) => events.push(`begin ${title}`),
        report: (message, percentage) => events.push(`report ${message} ${String(percentage)}`),
        done: () => events.push("done"),
      }),
  };
}

describe("withProgress", () => {
  it("begins, runs the work, then ends, and returns what the work returns", async () => {
    const { events, open } = recorder();
    const result = await withProgress(open, "Stateward: checking", () => {
      events.push("work");
      return Promise.resolve(7);
    });
    expect(result).toBe(7);
    expect(events).toEqual(["begin Stateward: checking", "work", "done"]);
  });

  it("hands the work the progress to report on, and a silent one when it cannot be opened", async () => {
    const { events, open } = recorder();
    await withProgress(open, "t", (progress) => {
      progress.report("1 of 2 files", 45);
      return Promise.resolve();
    });
    expect(events).toEqual(["begin t", "report 1 of 2 files 45", "done"]);
    const silent = await withProgress(
      () => Promise.reject(new Error("client said no")),
      "t",
      (progress) => Promise.resolve(progress),
    );
    expect(silent).toBe(SILENT_PROGRESS);
  });

  it("ends the progress when the work throws, and passes the error on", async () => {
    const { events, open } = recorder();
    const failure = new Error("boom");
    await expect(withProgress(open, "t", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(events).toEqual(["begin t", "done"]);
  });

  it("ends the progress when the work throws before its first await", async () => {
    const { events, open } = recorder();
    await expect(
      withProgress(open, "t", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(events).toEqual(["begin t", "done"]);
  });

  it("still runs the work when the progress cannot be opened", async () => {
    const result = await withProgress(
      () => Promise.reject(new Error("client said no")),
      "t",
      () => Promise.resolve("ran"),
    );
    expect(result).toBe("ran");
  });
});
