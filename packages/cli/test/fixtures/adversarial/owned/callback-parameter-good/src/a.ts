import { session } from "./session.js";

export function run(f: (count: number) => void): void {
  f(session.count);
}
