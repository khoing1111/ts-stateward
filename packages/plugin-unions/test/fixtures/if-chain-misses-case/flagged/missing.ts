type Status =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; after: number };

type Mode = "r" | "w" | "rw";

export function missing(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return status.pid;
  }
  return -1;
}

export function reversed(status: Status): number {
  if ("idle" === status.kind) {
    return 0;
  } else if ("running" === status.kind) {
    return 1;
  } else if (status.kind === "failed") {
    return 2;
  }
  return -1;
}

export function plain(mode: Mode): number {
  if (mode === "r") {
    return 0;
  } else if (mode === "w") {
    return 1;
  }
  return -1;
}

export function spaced(status: Status): number {
  if (status . kind === "idle") {
    return 0;
  } else if (status
    .kind === "running") {
    return 1;
  }
  return -1;
}

export function nested(status: Status, mode: Mode): number {
  if (mode === "r") {
    if (status.kind === "idle") {
      return 0;
    } else if (status.kind === "running") {
      return 1;
    }
  }
  return -1;
}
