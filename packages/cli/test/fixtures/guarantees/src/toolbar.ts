import { session } from "./session";
import { setTheme, settings } from "./settings";

export function onDark(): void {
  if (settings.theme !== "dark") setTheme("dark");
}

export function onLogout(): void {
  session.user = null;
}
