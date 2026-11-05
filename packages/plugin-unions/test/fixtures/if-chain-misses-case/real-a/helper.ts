// the app's own `never` helper is named, not a stateward package.
function ensureNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

type Step = "draft" | "review" | "done";

export function stepIndex(step: Step): number {
  if (step === "draft") {
    return 0;
  } else if (step === "review") {
    return 1;
  } else if (step === "done") {
    return 2;
  }
  return ensureNever(step);
}

export function stepName(step: Step): string {
  if (step === "draft") {
    return "Draft";
  } else if (step === "review") {
    return "Review";
  } else {
    return "Other";
  }
}

export function stepCount(step: Step): number {
  if (step === "draft") {
    return 0;
  } else if (step === "review") {
    return 1;
  }
  return -1;
}
