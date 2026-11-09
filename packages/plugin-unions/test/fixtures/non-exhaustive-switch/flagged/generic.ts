export function constrained<T extends "a" | "b" | "c">(value: T): number {
  switch (value) {
    case "a":
      return 1;
    default:
      return 0;
  }
}
