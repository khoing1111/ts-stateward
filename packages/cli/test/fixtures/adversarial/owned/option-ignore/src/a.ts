import { session } from "./session.js";

export function bump(): void {
  session.count++;
}
