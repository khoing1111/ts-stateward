import { session } from "./session.js";

export function count(): number {
  const holder = {
    get count() {
      return session.count;
    },
  };
  return holder.count;
}
