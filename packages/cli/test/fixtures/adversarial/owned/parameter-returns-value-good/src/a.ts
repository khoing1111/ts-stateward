import { session } from "./session.js";

function count(s: { count: number }): number {
  return s.count;
}

export function run(): number {
  return count(session);
}
