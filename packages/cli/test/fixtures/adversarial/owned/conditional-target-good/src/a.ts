import { session } from "./session.js";

export function count(flag: boolean, other: { count: number }): number {
  return (flag ? session : other).count;
}
