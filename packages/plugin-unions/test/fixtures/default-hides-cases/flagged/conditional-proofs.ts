import { assertNever as fail } from "./never.js";

type S = { kind: "a" } | { kind: "b" };

declare const flag: boolean;
declare function later(callback: () => void): void;

export function inIf(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default: {
      if (flag) {
        fail(s);
      }
      return 0;
    }
  }
}

export function inFunction(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      later(() => fail(s));
      return 0;
  }
}

export function inLoop(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      for (const _ of [1]) fail(s);
      return 0;
  }
}

export function inTry(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      try {
        fail(s);
      } catch {
        return 0;
      }
      return 0;
  }
}

export function afterAnd(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return flag && fail(s);
  }
}

export function inTernary(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return flag ? fail(s) : 0;
  }
}

export function inNestedSwitch(s: S): number {
  switch (s.kind) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      switch (flag) {
        case true:
          return fail(s);
        case false:
          return 0;
      }
  }
}
