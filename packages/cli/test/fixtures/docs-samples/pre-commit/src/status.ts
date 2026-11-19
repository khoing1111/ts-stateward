type Status = "idle" | "loading" | "failed";

export function label(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading";
    default:
      return "Busy";
  }
}
