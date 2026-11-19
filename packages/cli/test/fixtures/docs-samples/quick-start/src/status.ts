type Status = "idle" | "loading" | "ready" | "failed";

export function label(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    default:
      return "Busy";
  }
}
