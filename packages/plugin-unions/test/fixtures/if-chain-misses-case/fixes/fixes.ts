type Upload =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "failed"; reason: string }
  | { kind: "retry"; after: number };

export function discriminant(upload: Upload): number {
  if (upload.kind === "idle") {
    return 0;
  } else if (upload.kind === "running") {
    return upload.pid;
  } else {
    return -1;
  }
}

export function valueFirst(mode: "r" | "w" | "x"): number {
  if ("r" === mode) {
    return 1;
  } else if ("w" === mode) {
    return 2;
  } else return 0;
}

export enum Level {
  Low,
  Mid,
  High,
}

export function enums(level: Level): string {
  if (level === Level.Low) {
    return "low";
  } else if (level === Level.Mid) {
    return "mid";
  } else {
    return "high";
  }
}

export function optional(size?: "s" | "m" | null): number {
  if (size === "s") {
    return 1;
  } else if (size === "m") {
    return 2;
  } else {
    return 0;
  }
}

export function typeOf(value: string | number | boolean | undefined): number {
  if (typeof value === "string") {
    return 1;
  } else if (typeof value === "number") {
    return 2;
  } else {
    return 0;
  }
}

type Shape = { width: number } | { radius: number } | { side: number };

// An object type is not one value: no quick fix.
export function shapes(shape: Shape): number {
  if ("width" in shape) {
    return shape.width;
  } else if ("radius" in shape) {
    return shape.radius;
  } else {
    return 0;
  }
}
