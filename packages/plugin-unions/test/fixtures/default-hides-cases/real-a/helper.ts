// the app has its own `never` helper; fixes and hints use it, not a
// stateward package the app does not have.
export function ensureNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

type Step = "draft" | "review" | "done";

export function stepIndex(step: Step): number {
  switch (step) {
    case "draft":
      return 0;
    case "review":
      return 1;
    case "done":
      return 2;
    default:
      return -1;
  }
}

export function stepName(step: Step): string {
  switch (step) {
    case "draft":
      return "Draft";
    default:
      return "Other";
  }
}
