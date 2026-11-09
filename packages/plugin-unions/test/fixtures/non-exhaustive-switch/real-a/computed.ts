// TypeScript does not narrow a computed subject, so no check on it
// compiles. The hint puts it in a `const` first; there is no quick fix.
type AlertMode = "none" | "sound" | "banner";
type Draft = { alertMode?: AlertMode };

export function alertLabel(draft: Draft): string {
  switch (draft.alertMode ?? "none") {
    case "none":
      return "Off";
    case "sound":
      return "Sound";
    case "banner":
      return "Banner";
    default:
      return "";
  }
}

declare function getAlertMode(): AlertMode;

export function alertIcon(): string {
  switch (getAlertMode()) {
    case "none":
      return "";
    default:
      return "bell";
  }
}
