import { session } from "./session.js";

export function total(): number {
  let sum = 0;
  for (const s of [session]) sum += s.count;
  return sum;
}
