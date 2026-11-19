import { session } from "./session.js";

export function set(key: string): void {
  const table = { a: session };
  table[key]!.count = 1;
}
