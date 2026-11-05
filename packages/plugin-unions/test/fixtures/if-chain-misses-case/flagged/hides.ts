type Status =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; after: number };

export function hides(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return status.pid;
  } else {
    return -1;
  }
}

export function hidesOne(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else if (status.kind === "failed") {
    return 2;
  } else {
    return -1;
  }
}

export function hidesTypeof(value: string | number | boolean): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  } else {
    return 0;
  }
}

export function ifInElse(status: Status): number {
  if (status.kind === "idle") {
    return 0;
  } else if (status.kind === "running") {
    return 1;
  } else if (status.kind === "failed") {
    return 2;
  } else return -1;
}

// Many cases treated alike by the `else` (excalidraw's `return 20` for 11 element types).
type Shape = "arrow" | "line" | "box" | "ellipse" | "diamond" | "frame" | "image";

export function padding(shape: Shape): number {
  if (shape === "arrow") {
    return 40;
  } else if (shape === "line") {
    return 30;
  } else {
    return 20;
  }
}
