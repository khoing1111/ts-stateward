import { session } from "./session.js";

export function tag(): void {
  Array.prototype.push.call(session.tags, "q");
}
