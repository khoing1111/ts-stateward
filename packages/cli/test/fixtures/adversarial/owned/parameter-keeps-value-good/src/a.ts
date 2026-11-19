import { session } from "./session.js";

function show(s: { count: number }): string {
  return String(s.count);
}

export function run(): string {
  return show(session);
}
