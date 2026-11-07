import { settings } from "./settings.js";
import { apply } from "./apply.js";

const handlers: Record<string, (value: object) => void> = {};

export function hand(name: string): void {
  apply(settings);
  handlers[name]?.(settings);
}
