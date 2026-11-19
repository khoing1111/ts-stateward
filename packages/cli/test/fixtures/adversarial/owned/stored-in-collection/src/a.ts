import { session } from "./session.js";

const keep: unknown[] = [];

export function remember(): void {
  keep.push(session);
}
