import { session } from "./session.js";

export function rename(target: typeof session): void {
  target.user = "guest";
}

export function guest(): void {
  rename(session);
}
