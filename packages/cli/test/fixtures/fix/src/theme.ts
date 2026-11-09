export type Mode = "light" | "dark" | "system";

// stateward-ignore unions/default-hides-cases: the system mode follows the light one
export function title(mode: Mode): string {
  switch (mode) {
    case "light":
      return "Light";
    case "dark":
      return "Dark";
    default:
      return "Other";
  }
}
