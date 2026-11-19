import { session } from "./session.js";

export function bump(): void {
  const all = [session];
  all[0]!.count = 2;
}
