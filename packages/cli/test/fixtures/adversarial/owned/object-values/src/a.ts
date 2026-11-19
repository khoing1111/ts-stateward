import { session } from "./session.js";

export function bump(): void {
  const first = Object.values({ session })[0]!;
  first.count = 1;
}
