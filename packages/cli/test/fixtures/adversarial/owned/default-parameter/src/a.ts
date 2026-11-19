import { session } from "./session.js";

export function rename(s = session): void {
  s.user = "x";
}
