// An `else` that says which cases fall through on purpose: the type names exactly those.
type Event = { type: "click" } | { type: "key" } | { type: "scroll" } | { type: "resize" };
type Mode = "r" | "w" | "x";

export function restOfEvents(event: Event): number {
  if (event.type === "click") {
    return 1;
  } else if (event.type === "key") {
    return 2;
  } else {
    event.type satisfies Exclude<Event["type"], "click" | "key">;
    return 0;
  }
}

export function restOfModes(mode: Mode): number {
  if (mode === "r") {
    return 1;
  } else if (mode === "w") {
    return 2;
  } else {
    void (mode satisfies "x");
    return 0;
  }
}
