type EventName = "open" | "close" | "move" | "resize" | "focus" | "blur" | "scroll" | "drag";

// above `maxHidden`, `undefined` and `null` are named first.
export function maybeHidden(name: EventName | null | undefined): number {
  switch (name) {
    case "open":
      return 1;
    case "close":
      return 2;
    default:
      return 0;
  }
}
