import type { Owned } from "./guarantees.js";
import { apply } from "./apply.js";

type Settings = { theme: string; fontSize: number; tags: string[]; extra?: string };

export const settings: Owned<Settings> = { theme: "light", fontSize: 14, tags: [] };

export function setTheme(theme: string): void {
  settings.theme = theme;
}

export function setFontSize(size: number): void {
  settings.fontSize = size;
  settings.tags.push("sized");
}

export function getSettings() {
  return settings;
}

export function applyAll(): void {
  apply(settings);
}
