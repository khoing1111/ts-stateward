import { session } from "./session.js";

export function count(): number {
  return Object.values({ session })[0]!.count;
}
