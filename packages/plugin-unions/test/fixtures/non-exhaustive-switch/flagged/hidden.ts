type Status = { kind: "idle" } | { kind: "retry" } | { kind: "cancel" };

export function discriminant(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    default:
      return 0;
  }
}

export function oneHidden(mode: "r" | "w"): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      return 0;
  }
}

export function numbers(level: 1 | 2 | 3): number {
  switch (level) {
    case 1:
      return 1;
    default:
      return 0;
  }
}

export function nullable(value: "a" | null): number {
  switch (value) {
    case "a":
      return 1;
    default:
      return 0;
  }
}

export function optional(value: "a" | undefined): number {
  switch (value) {
    case "a":
      return 1;
    default:
      return 0;
  }
}

export function parenthesized(status: Status): number {
  switch (status . kind) {
    case "retry":
    case "cancel":
      return 1;
    default:
      return 0;
  }
}
