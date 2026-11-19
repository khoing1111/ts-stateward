import { session } from "./session.js";

export function tag(): string[] {
  const tags = [...session.tags];
  Array.prototype.push.call(tags, "q");
  return tags;
}
