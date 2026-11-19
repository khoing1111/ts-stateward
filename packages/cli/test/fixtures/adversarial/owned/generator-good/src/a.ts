import { counts } from "./gen.js";

export function total(): number {
  let sum = 0;
  for (const count of counts()) sum += count;
  return sum;
}
