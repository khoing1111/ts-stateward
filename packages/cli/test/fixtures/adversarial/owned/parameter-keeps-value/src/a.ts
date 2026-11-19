import { session } from "./session.js";

const keep: { count: number }[] = [];

function remember(s: { count: number }): void {
  keep.push(s);
}

export function run(): void {
  remember(session);
}
