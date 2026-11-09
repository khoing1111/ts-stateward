type Status = "idle" | "running" | "done" | "failed";

// `noImplicitReturns`: TypeScript reports the missing case of an inferred return type (TS7030).
export function text(s: Status) {
  switch (s) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "done":
      return "Done";
  }
}

// Still reported: nothing is returned, so TypeScript accepts the missing case.
export function log(s: Status): void {
  switch (s) {
    case "idle":
      console.log("idle");
  }
}
