export type Status = "idle" | "uploading" | "failed";

export function label(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    default:
      return "Other";
  }
}

export function note(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "uploading":
      return "Uploading";
    default:
      return "Other";
  }
}

// Filled at run time, so its type cannot say which keys it has: only the lookup rule speaks.
declare function loadWords(): Record<string, string>;
const words: Record<string, string> = loadWords();

export function word(status: Status): string | undefined {
  return words[status];
}

export function icon(status: Status): string {
  if (status === "idle") return "i";
  else if (status === "uploading") return "u";
  return "?";
}
