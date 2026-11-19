import { session } from "./session.js";

const holder: { current: unknown } = { current: undefined };

export function remember(): void {
  holder.current = session;
}
