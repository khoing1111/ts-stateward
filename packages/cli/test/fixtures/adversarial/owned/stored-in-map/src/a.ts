import { session } from "./session.js";

export function bump(): void {
  const m = new Map([["k", session]]);
  m.get("k")!.count = 1;
}
