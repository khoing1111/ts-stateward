type Status = "idle" | "failed" | "done";
type Job = { kind: Status };

declare const status: Status;
declare const job: Job;

const labels: Record<string, string> = { idle: "Idle", done: "Done" };
const partial: { idle: string; [key: string]: string } = { idle: "Idle" };

export const onlyIndex = labels[status];
export const mixed = partial[status];
export const discriminant = labels[job.kind];
export const nested = {
  inner: labels[
    status
  ],
};
