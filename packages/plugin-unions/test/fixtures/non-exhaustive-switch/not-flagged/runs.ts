import { assertNever as fail } from "./never.js";

type S = { kind: "a" } | { kind: "b" };

declare const flag: boolean;

export function afterOtherWork(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      if (flag) return 0;
      return fail(s);
  }
}

export function inBlock(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default: {
      void flag;
      return fail(s);
    }
  }
}

export function thrown(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      throw new Error(`bad ${String(fail(s))}`);
  }
}

export function declared(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default: {
      const unreachable = fail(s);
      return unreachable;
    }
  }
}
