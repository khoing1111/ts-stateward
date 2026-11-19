import { settings } from "./settings.js";

export function restore(): void {
  settings.reset();
}
