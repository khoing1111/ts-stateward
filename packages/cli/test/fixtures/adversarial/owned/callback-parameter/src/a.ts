import { session } from "./session.js";

export function run(f: (s: { count: number }) => void): void {
  f(session);
}
