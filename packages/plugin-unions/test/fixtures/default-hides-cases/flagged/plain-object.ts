type Job = { kind: "idle" | "retry" | "cancel"; note: string };

export function hidden(job: Job): number {
  switch (job.kind) {
    case "idle":
      return 1;
    default:
      return 0;
  }
}

export function complete(job: Job): number {
  switch (job.kind) {
    case "idle":
      return 1;
    case "retry":
    case "cancel":
      return 2;
    default:
      return 0;
  }
}
