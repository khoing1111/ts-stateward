type Mode = "r" | "w";

export function text(value: string): number {
  switch (value) {
    case "a":
      return 1;
    default:
      return 0;
  }
}

export function count(value: number): number {
  switch (value) {
    case 1:
      return 1;
    default:
      return 0;
  }
}

export function mixed(value: 1 | string): number {
  switch (value) {
    case 1:
      return 1;
    default:
      return 0;
  }
}

export function object(value: { a: number }): number {
  switch (value) {
    default:
      return 0;
  }
}

export function unconstrained<T>(value: T): number {
  switch (value) {
    default:
      return 0;
  }
}

export function conditions(x: number): number {
  switch (true) {
    case x > 1:
      return 1;
    default:
      return 0;
  }
}

declare const dynamic: Mode;

export function variableCase(mode: Mode): number {
  switch (mode) {
    case dynamic:
      return 1;
    default:
      return 0;
  }
}

export function noClauses(mode: Mode): number {
  switch (mode) {
  }
  return 0;
}
