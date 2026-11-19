import { session } from "./session.js";

export function edit(): void {
  const copy = { ...session, tags: [...session.tags] };
  copy.count = 5;
  copy.tags.push("x");
}
