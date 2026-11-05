export type Mode = "light" | "dark";

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
