import { session } from "./session.js";

export function read(): number {
  const table = { a: session };
  return table.a.count;
}
