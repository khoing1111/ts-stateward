import { session } from "./session.js";

export function nameOf(given?: typeof session): string {
  const target = given ?? session;
  return target.user ?? "nobody";
}
