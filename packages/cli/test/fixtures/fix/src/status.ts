export type Status = "idle" | "uploading" | "failed";

// stateward-ignore unions/default-hides-cases: a failed upload shows the default label
export function label(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "uploading":
      return "Uploading";
    default:
      return "Other";
  }
}

// stateward-ignore unions/default-hides-cases: only an idle upload has its own icon
export function icon(status: Status): string {
  switch (status) {
    case "idle":
      return "i";
    default:
      return "?";
  }
}
