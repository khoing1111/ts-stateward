import { session } from "./session.js";

export function reset(): void {
  for (const s of [session]) s.count = 9;
}
