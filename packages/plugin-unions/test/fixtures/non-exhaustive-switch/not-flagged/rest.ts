// A `default` that says which cases fall through on purpose: the type names exactly those.
type Event = { type: "click" } | { type: "key" } | { type: "scroll" } | { type: "resize" };
type Other = Exclude<Event["type"], "click" | "key">;
type Mode = "r" | "w" | "x";

export function aliasRest(event: Event): number {
  switch (event.type) {
    case "click":
      return 1;
    case "key":
      return 2;
    default:
      event.type satisfies Other;
      return 0;
  }
}

export function literalRest(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      mode satisfies "w" | "x";
      return 0;
  }
}

export function excludeRest(mode: Mode): number {
  switch (mode) {
    case "r":
      return 1;
    default:
      void (mode satisfies Exclude<Mode, "r">);
      return 0;
  }
}

export function declarationRest(mode: Mode): number {
  switch (mode) {
    case "w":
      return 1;
    default: {
      const left: "r" | "x" = mode;
      return left === "r" ? 0 : 2;
    }
  }
}
