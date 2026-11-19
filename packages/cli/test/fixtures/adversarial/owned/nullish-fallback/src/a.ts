import { session } from "./session.js";

export function rename(given?: typeof session): void {
  const target = given ?? session;
  target.user = "guest";
}
