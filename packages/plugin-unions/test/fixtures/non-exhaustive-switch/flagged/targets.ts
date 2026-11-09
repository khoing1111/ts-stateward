type Shared = { mode: "x" | "y"; p: 1 } | { mode: "x" | "y"; q: 1 };
type Tagged = { kind: "a"; x: 1 } | { kind: "b" };

// Every member has the same union for `mode`: `v` is not narrowed, so the subject is the proof.
export function shared(v: Shared): number {
  switch (v.mode) {
    case "x":
      return 1;
    case "y":
      return 2;
    default:
      return 0;
  }
}

// `s` can be undefined: `s?.kind` narrows `s` all the same, so the proof is on `s`.
export function nullable(s: Tagged | undefined): number {
  switch (s?.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    case undefined:
      return 3;
    default:
      return 0;
  }
}

// A discriminated union: `s` is never in the default, so the proof is on `s`.
export function discriminated(s: Tagged): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

export function plain(o: { kind: "a" | "b" }): number {
  switch (o.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

export function generic<T extends Tagged>(t: T): number {
  switch (t.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

export function genericSubject<T extends "a" | "b">(x: T): number {
  switch (x) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}
