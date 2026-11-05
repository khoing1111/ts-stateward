import { assertNever } from "./never.js";

// `typeof x` is the name of a type, not a union `x` is narrowed by: the switch is out of scope.
export function proven(x: string | number): number {
  switch (typeof x) {
    case "string":
      return 1;
    case "number":
      return 2;
    default:
      return assertNever(x);
  }
}

export function unproven(x: string | number): number {
  switch (typeof x) {
    case "string":
      return 1;
    default:
      return 0;
  }
}

export function parenthesized(x: string | number): number {
  switch (typeof (x)) {
    case "string":
      return 1;
    default:
      return 0;
  }
}
