import { session } from "./session.js";

export function tag(): void {
  session.tags.forEach((_tag, _index, all) => {
    all.push("x");
  });
}
