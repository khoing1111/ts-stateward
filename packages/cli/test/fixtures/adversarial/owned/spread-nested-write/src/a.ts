import { session } from "./session.js";

export function edit(): void {
  const copy = { ...session };
  copy.tags.push("x");
  copy.meta.n = 3;
}
