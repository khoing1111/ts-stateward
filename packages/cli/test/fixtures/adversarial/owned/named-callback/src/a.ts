import { session } from "./session.js";

function touch(s: { count: number }): void {
  s.count = 1;
}

export function run(): void {
  [session].forEach(touch);
}
