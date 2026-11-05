type Tagged = { kind: "a"; x: 1 } | { kind: "b" } | { kind: "c" };

export function generic<T extends Tagged>(t: T): number {
  if (t.kind === "a") {
    return 1;
  } else if (t.kind === "b") {
    return 2;
  }
  return 0;
}

export function genericSubject<T extends "a" | "b" | "c">(x: T): number {
  if (x === "a") {
    return 1;
  } else if (x === "b") {
    return 2;
  } else {
    return 0;
  }
}
