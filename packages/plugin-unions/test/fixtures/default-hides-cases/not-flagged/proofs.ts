import { assertNever } from "./never.js";
import { assertNever as unreachable } from "./never.js";

type Status = { kind: "idle" | "retry" | "cancel"; note: string };
type Event = { kind: "idle" } | { kind: "retry" } | { kind: "cancel" };

// The project's own helper: decided by its parameter, not its name.
function fail(value: never, note: string): never {
  throw new Error(`${String(value)} ${note}`);
}

export function satisfiesProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
    case "cancel":
      return 2;
    default:
      status.kind satisfies never;
      return 0;
  }
}

export function spacedProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
    case "cancel":
      return 2;
    default:
      status
        .kind satisfies never;
      return 0;
  }
}

export function declarationProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default: {
      const nothing: never = status.kind;
      return nothing;
    }
  }
}

export function packageProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default:
      return assertNever(status.kind, "status");
  }
}

export function aliasedProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default:
      return unreachable(status.kind);
  }
}

export function ownProof(status: Status): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default:
      return fail(status.kind, "status");
  }
}

// In a discriminated union `status` is never in the default, and `status.kind` no longer exists:
// proving the object proves the switch on its property.
export function objectProof(status: Event): number {
  switch (status.kind) {
    case "idle":
      return 1;
    case "retry":
      return 2;
    case "cancel":
      return 3;
    default:
      return assertNever(status);
  }
}

export function genericProof<T extends "a" | "b">(value: T): number {
  switch (value) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return assertNever(value);
  }
}

export function enumProof(flag: boolean): number {
  switch (flag) {
    case true:
      return 1;
    case false:
      return 2;
    default:
      return assertNever(flag);
  }
}
