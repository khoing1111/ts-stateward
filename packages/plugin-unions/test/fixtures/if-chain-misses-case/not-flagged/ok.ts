import { assertNever } from "./never.js";

type Status =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "failed"; reason: string };
type Mode = "r" | "w";

function never(value: never): never {
  throw new Error(String(value));
}

// A single `if` is a guard clause, however partial.
export function guardClause(status: Status): number {
  if (status.kind === "failed") return -1;
  return 0;
}

export function guardWithElse(status: Status): number {
  if (status.kind === "failed") {
    return -1;
  } else {
    return 0;
  }
}

// Tests on different references.
export function mixed(a: Status, b: Status): number {
  if (a.kind === "idle") {
    return 0;
  } else if (b.kind === "idle") {
    return 1;
  }
  return 2;
}

export function mixedProperties(a: Status & { other: Mode }): number {
  if (a.kind === "idle") {
    return 0;
  } else if (a.other === "r") {
    return 1;
  }
  return 2;
}

// Every case handled, no else: TypeScript narrows the rest to never.
export function completeNoElse(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else if (status.kind === "failed") {
    return 2;
  }
  return -1;
}

export function completeOr(mode: Mode): number {
  if (mode === "r" || mode === "w") {
    return 0;
  } else if (mode === "r") {
    return 1;
  }
  return -1;
}

// An else with a proof, in each of the three forms.
export function proofAssert(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else {
    return assertNever(status, "status");
  }
}

export function proofSatisfies(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  } else {
    mode satisfies never;
    return 2;
  }
}

export function proofDeclaration(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  } else {
    const unreachable: never = mode;
    return unreachable;
  }
}

export function proofOwnHelper(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else if (status.kind === "failed") {
    return 2;
  } else {
    return never(status);
  }
}

export function proofOnDiscriminant(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else {
    return assertNever(status);
  }
}

// Tests that are not one of the forms: the rule does not apply.
export function otherTests(status: Status, count: number): number {
  if (status.kind === "idle") {
    return 0;
  } else if (count > 3) {
    return 1;
  }
  return 2;
}

export function notEqual(mode: Mode): number {
  if (mode !== "r") {
    return 0;
  } else if (mode !== "w") {
    return 1;
  }
  return 2;
}

export function andTests(status: Status, count: number): number {
  if (status.kind === "idle" && count > 1) {
    return 0;
  } else if (status.kind === "running" && count > 2) {
    return 1;
  }
  return 2;
}

export function negated(mode: Mode): number {
  if (!(mode === "r")) {
    return 0;
  } else if (mode === "w") {
    return 1;
  }
  return 2;
}

// Not a finite union.
export function plainString(text: string): number {
  if (text === "a") {
    return 0;
  } else if (text === "b") {
    return 1;
  }
  return 2;
}

export function plainNumber(n: number): number {
  if (n === 1) {
    return 0;
  } else if (n === 2) {
    return 1;
  }
  return 2;
}

// A value that is not one literal.
export function variableValue(mode: Mode, other: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === other) {
    return 1;
  }
  return 2;
}

// Same reference compared with itself twice does not make it a union of one test.
export function singleVariantType(only: "a"): number {
  if (only === "a") {
    return 0;
  } else if (only === "a") {
    return 1;
  }
  return 2;
}

// A call that is not a type guard.
function check(value: Mode): boolean {
  return value === "r";
}
export function plainCall(mode: Mode): number {
  if (check(mode)) {
    return 0;
  } else if (check(mode)) {
    return 1;
  }
  return 2;
}

// Calls and element accesses are not the same value twice.
declare function next(): Status;
export function calls(): number {
  if (next().kind === "idle") {
    return 0;
  } else if (next().kind === "running") {
    return 1;
  }
  return 2;
}

export function elements(list: readonly Status[]): number {
  if (list[0]?.kind === "idle") {
    return 0;
  } else if (list[0]?.kind === "running") {
    return 1;
  }
  return 2;
}
