type Mode = "r" | "w";

// Named like the real one, but its parameter is not never: not a proof.
function assertNever(value: string): never {
  throw new Error(value);
}

declare const unrelated: never;
declare function consume(value: Mode): void;

export function weakAssert(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    case "w":
      return 2;
    default:
      return assertNever(mode);
  }
}

export function otherNever(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    case "w":
      return 2;
    default:
      return assertNever(unrelated);
  }
}

export function plainCall(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      consume(mode);
      return 0;
  }
}

export function neverButNotTheSubject(mode: Mode, other: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    case "w":
      return 2;
    default: {
      const unreachable: never = unrelated;
      return other === "r" ? 1 : unreachable;
    }
  }
}
