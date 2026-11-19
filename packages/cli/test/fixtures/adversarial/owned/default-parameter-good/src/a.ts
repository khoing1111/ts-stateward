import { session } from "./session.js";

export function rename(count = session.count): number {
  return count + 1;
}
