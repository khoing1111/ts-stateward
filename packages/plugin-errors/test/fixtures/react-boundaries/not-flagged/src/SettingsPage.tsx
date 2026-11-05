import { readSettings } from "./settings";

export function SettingsPage() {
  const settings = readSettings(localStorage.getItem("settings") ?? "{}");
  return <form>Theme: {settings.theme}</form>;
}
