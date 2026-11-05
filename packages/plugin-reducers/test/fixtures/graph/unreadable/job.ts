export type JobEvent = { type: "start" } | { type: "finish" } | { type: "promo" };

/** @final "done" */
export type JobState = { status: "queued" } | { status: "running" } | { status: "done" };

function applyEvent(state: JobState, event: JobEvent): JobState {
  return event.type === "start" ? { status: "running" } : state;
}

/** @initial "queud" */
export function jobReducer(state: JobState, event: JobEvent): JobState {
  if (event.type === "finish") return { status: "done" };
  return applyEvent(state, event);
}
