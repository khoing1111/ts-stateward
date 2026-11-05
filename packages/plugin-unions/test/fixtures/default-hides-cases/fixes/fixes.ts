type GeneratingType = "summary" | "outline" | "quiz" | "flashcards";

export function generate(generatingType: GeneratingType, log: string[]): void {
  switch (generatingType) {
    case "summary":
      log.push("summary");
      break;
    default:
      break;
  }
}

export enum Tone {
  Calm = "calm",
  Loud = "loud",
  Silent = "silent",
}

export function volume(tone: Tone): number {
  switch (tone) {
    case Tone.Calm:
      return 1;
    default:
      return 0;
  }
}

export function optional(size?: "s" | "m" | "l" | null): number {
  switch (size) {
    case "s":
      return 1;
    default:
      return 0;
  }
}

// "a" falls into the default body, which runs to the end of the switch: both keep doing so.
export function fallThrough(step: "a" | "b" | "c" | "d", log: string[]): void {
  switch (step) {
    case "a":
      log.push("a");
    // falls through
    case "b":
    default:
      log.push("rest");
  }
}

// A default in the middle that returns: the new default goes right after it.
export function middleReturns(step: "a" | "b" | "c"): number {
  switch (step) {
    default:
      return 0;
    case "a":
      return 1;
  }
}

// A default in the middle that falls into the case after it: the new default would too, where
// `step` is no longer `never`. No fix.
export function middle(step: "a" | "b" | "c", log: string[]): void {
  switch (step) {
    default:
      log.push("default");
    // falls through
    case "a":
      log.push("a");
  }
}

// An empty default: the listed cases do nothing, as before, then leave the switch.
export function empty(flag: boolean): number {
  switch (flag) {
    case true:
      return 1;
    default:
  }
  return 0;
}

// The copied `return` would read `label`, declared in the old body: no fix.
export function declares(mode: "r" | "w" | "x"): string {
  switch (mode) {
    case "r":
      return "read";
    default: {
      const label = mode.toUpperCase();
      return label;
    }
  }
}

// `read()` would run again in the new default, and TypeScript does not narrow a call: no fix.
export function call(read: () => "x" | "y"): number {
  switch (read()) {
    case "x":
      return 1;
    default:
      return 0;
  }
}
