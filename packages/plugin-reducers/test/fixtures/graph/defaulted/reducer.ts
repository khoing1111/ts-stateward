/** @final "done" */
export type UploadState =
  | { phase: "idle" }
  | { phase: "sending"; progress: number }
  | { phase: "retrying"; attempt: number }
  | { phase: "done"; url: string };

export type UploadAction =
  | { type: "start" }
  | { type: "progress"; progress: number }
  | { type: "finish"; url: string };

const initialUpload: UploadState = { phase: "idle" };

// No useReducer and no @initial: the default of `state` says where it starts.
export function uploadReducer(
  state: UploadState = initialUpload,
  action: UploadAction,
): UploadState {
  switch (action.type) {
    case "start":
      if (state.phase !== "idle") return state;
      return { phase: "sending", progress: 0 };
    case "progress":
      if (state.phase !== "sending") return state;
      return { phase: "sending", progress: action.progress };
    case "finish":
      if (state.phase !== "sending") return state;
      return { phase: "done", url: action.url };
  }
}
