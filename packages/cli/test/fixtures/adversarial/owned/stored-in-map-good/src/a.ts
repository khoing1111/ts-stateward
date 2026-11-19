import { session } from "./session.js";

export function read(): number {
  const m = new Map([["k", session.count]]);
  return m.get("k") ?? 0;
}
