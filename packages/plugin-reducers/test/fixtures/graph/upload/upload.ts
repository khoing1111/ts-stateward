export type UploadEvent =
  | { type: "pick"; file: string }
  | { type: "progress"; sent: number }
  | { type: "finish" }
  | { type: "fail"; reason: string }
  | { type: "retry" }
  | { type: "restart" }
  | { type: "discard" };

/** @final "done" | "discarded" | "payed" */
export type UploadState =
  | { phase: "idle" }
  | { phase: "draft"; file: string }
  | { phase: "scheduled"; file: string }
  | { phase: "queued"; file: string }
  | { phase: "sending"; file: string; sent: number }
  | { phase: "failed"; file: string; reason: string }
  | { phase: "done" }
  | { phase: "discarded" };

/** @initial "idle" */
export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (state.phase) {
    case "idle":
      if (event.type === "pick") return { phase: "queued", file: event.file };
      return state;
    case "queued":
      return { phase: "sending", file: state.file, sent: 0 };
    case "sending":
      switch (event.type) {
        case "progress":
          return { ...state, sent: event.sent };
        case "finish":
          return { phase: "done" };
        case "fail":
          return { phase: "failed", file: state.file, reason: event.reason };
        default:
          return state;
      }
    case "failed":
      return event.type === "retry" ? { phase: "queued", file: state.file } : state;
    case "done":
      if (event.type === "restart") return { phase: "idle" };
      return state;
    case "draft":
      return { phase: "scheduled", file: state.file };
    case "scheduled":
      return { phase: "queued", file: state.file };
    case "discarded":
      return state;
  }
}
