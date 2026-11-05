// an `else` for "everything else" over many cases.
type EventName = "open" | "close" | "move" | "resize" | "focus" | "blur" | "scroll" | "drag";

export function isWindowChange(name: EventName): boolean {
  if (name === "open") {
    return true;
  } else if (name === "close") {
    return true;
  } else {
    return false;
  }
}
