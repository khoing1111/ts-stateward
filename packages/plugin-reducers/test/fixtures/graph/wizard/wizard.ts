export type WizardEvent =
  | { type: "next"; valid: boolean }
  | { type: "back" }
  | { type: "submit" }
  | { type: "saved" };

/** @final "complete" */
export type WizardState =
  | { step: "account" }
  | { step: "profile"; attempts: number }
  | { step: "confirm" }
  | { step: "complete" };

export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case "next":
      switch (state.step) {
        case "account":
          return { step: "profile", attempts: 0 };
        case "profile":
          // A condition on data: both branches count.
          if (state.attempts > 3) return { step: "account" };
          return event.valid ? { step: "confirm" } : { step: "profile", attempts: state.attempts + 1 };
        default:
          return state;
      }
    case "back":
      if (state.step === "confirm") return { step: "profile", attempts: 0 };
      return state;
    case "submit":
      return state.step === "confirm" ? { step: "complete" } : state;
    case "saved":
      return state;
  }
}

export function initWizard(resume: boolean): WizardState {
  return resume ? { step: "profile", attempts: 0 } : { step: "account" };
}
