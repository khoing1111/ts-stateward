import { session } from "./session.js";

function same(s: { count: number }): { count: number } {
  return s;
}

export function run(): void {
  same(session).count = 4;
}
