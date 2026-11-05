export type Status = "idle" | "uploading" | "failed";

export function label(status: Status): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "uploading":
      return "Uploading";
    case "failed":
      return "Failed";
    default:
      return "Other";
  }
}

export function icon(status: Status): string {
  if (status === "idle") {
    return "i";
  } else if (status === "uploading") {
    return "u";
  } else if (status === "failed") {
    return "f";
  } else {
    return "?";
  }
}
