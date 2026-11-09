type Mode = "r" | "w" | "x";

// The type names a case the switch already lists: the `default` takes "w" and "x", and this
// type is wider, so the finding stays.
export function namesListedCase(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      mode satisfies "r" | "w" | "x";
      return 0;
  }
}

// A check on another value says nothing about this switch.
export function checksOther(mode: Mode, other: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      other satisfies "w" | "x";
      return 0;
  }
}
