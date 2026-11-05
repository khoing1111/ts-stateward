type Status =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; after: number };

type Tagged = { kind: "a"; x: 1 } | { kind: "b" };

// `o?.kind` over a possibly undefined plain object: no proof compiles, so none is asked for.
export function plainOptional(o: { kind: "a" | "b" } | undefined): number {
  if (o?.kind === "a") {
    return 0;
  } else if (o?.kind === "b") {
    return 1;
  } else {
    return 2;
  }
}

export function plainOptionalMissing(o: { kind: "a" | "b" | "c" } | undefined): number {
  if (o?.kind === "a") {
    return 0;
  } else if (o?.kind === "b") {
    return 1;
  }
  return 2;
}

export function discriminatedOptional(s: Tagged | undefined): number {
  if (s?.kind === "a") {
    return 0;
  } else if (s?.kind === "b") {
    return 1;
  } else if (s === undefined) {
    return 2;
  }
  return 3;
}

// A chain that handles every present case, the last test being `undefined` or not: still unfinishable.
export function discriminatedMissing(status: Status | undefined): number {
  if (status?.kind === "idle") {
    return 0;
  } else if (status?.kind === "running") {
    return 1;
  } else if (status?.kind === "failed") {
    return 2;
  } else if (status?.kind === "retry") {
    return 3;
  }
  return -1;
}

