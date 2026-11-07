import type { Owned } from "./guarantees";

export const settings: Owned<{ theme: string }> = { theme: "light" };

export function setTheme(theme: string): void {
  settings.theme = theme;
}
