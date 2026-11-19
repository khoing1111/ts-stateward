import { counts } from "./gen.js";

export async function total(): Promise<number> {
  let sum = 0;
  for await (const count of counts()) sum += count;
  return sum;
}
