type Status = "idle" | "running" | "done" | "failed";

// The declared return type makes the missing case a type error (TS2366): TypeScript reports it.
export function declared(s: Status): string {
  switch (s) {
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "done":
      return "Done";
  }
}

// The same inside a branch that ends the function.
export const branch = (s: Status, loud: boolean): string => {
  if (loud) {
    return "!";
  } else {
    switch (s) {
      case "idle":
        return "Idle";
    }
  }
};

// Every case listed: nothing to report, with or without a `default`.
export function complete(s: Status): string {
  switch (s) {
    case "idle":
    case "running":
      return "busy";
    case "done":
    case "failed":
      return "over";
  }
}

// A `switch` with no clause tests nothing.
export function empty(s: Status): number {
  switch (s) {
  }
  return 0;
}
