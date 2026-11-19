import { session } from "./session.js";

export function tag(): void {
  Reflect.apply(Array.prototype.push, session.tags, ["x"]);
}
