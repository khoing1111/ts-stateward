import { session } from "./session.js";

export function bump(): void {
  const holder = {
    get s() {
      return session;
    },
  };
  holder.s.count = 1;
}
