// a default for "everything else" over many cases.
type EventName = "open" | "close" | "move" | "resize" | "focus" | "blur" | "scroll" | "drag";

export function isWindowChange(name: EventName): boolean {
  switch (name) {
    case "open":
    case "close":
      return true;
    default:
      return false;
  }
}

export function sixHidden(name: EventName): number {
  switch (name) {
    case "open":
      return 1;
    case "close":
      return 2;
    default:
      return 0;
  }
}

export function fiveHidden(name: EventName): number {
  switch (name) {
    case "open":
      return 1;
    case "close":
      return 2;
    case "move":
      return 3;
    default:
      return 0;
  }
}
