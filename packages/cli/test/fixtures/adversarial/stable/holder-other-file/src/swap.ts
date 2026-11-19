import { holder } from "./holder.js";

export function swap(): void {
  holder.current = { save: () => undefined };
}
