import { session } from "./session.js";

export function tag(): string[] {
  const tags = [...session.tags];
  Reflect.apply(Array.prototype.push, tags, ["x"]);
  return tags;
}
