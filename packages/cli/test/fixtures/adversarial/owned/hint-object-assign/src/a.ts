import { session } from "./session.js";

export function bump(): void {
  Object.assign(session, { count: 5 });
}
