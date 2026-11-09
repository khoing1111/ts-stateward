// An allowance names the cases a `default` handles on purpose; the others are still reported
// (and `tsc` rejects the check too).
export function partial(mode: "r" | "w" | "x"): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      void (mode satisfies "w");
      return 0;
  }
}

export function fromConst(kind: "a" | "b" | "c"): number {
  switch (kind) {
    case "a":
      return 1;
    default: {
      const rest: "b" | "c" = kind;
      return rest.length;
    }
  }
}

// Every case the `default` handles is allowed: correct.
export function allowed(size: "s" | "m" | "l"): number {
  switch (size) {
    case "s":
      return 1;
    default:
      void (size satisfies "m" | "l");
      return 0;
  }
}
