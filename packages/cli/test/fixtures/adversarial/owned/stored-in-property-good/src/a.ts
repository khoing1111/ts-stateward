import { session } from "./session.js";

const holder: { current: number } = { current: 0 };

export function remember(): void {
  holder.current = session.count;
}
