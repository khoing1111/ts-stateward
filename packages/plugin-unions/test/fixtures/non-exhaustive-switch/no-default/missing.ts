type Status = "idle" | "running" | "done" | "failed";

// No value returned: TypeScript accepts the missing case, and "failed" runs nothing.
export function log(s: Status): void {
  switch (s) {
    case "idle":
      console.log("idle");
      break;
    case "running":
      console.log("running");
      break;
    case "done":
      console.log("done"); // the last clause runs on to the end
  }
}

// An inferred return type takes `undefined` in: TypeScript accepts it.
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

// Code after the `switch` runs for "failed", as a `default` would.
export function code(s: Status): number {
  switch (s) {
    case "idle":
      return 0;
    case "running":
    case "done":
      return 1;
  }
  return -1;
}

// The last clause has no code: a value of it runs on to what is added after it.
export function shared(s: Status): number {
  let result = 0;
  switch (s) {
    case "idle":
      result = 1;
      break;
    case "running":
  }
  return result;
}
