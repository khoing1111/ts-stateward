import { session } from "./session.js";

const keep: number[] = [];

export function remember(): void {
  keep.push(session.count);
}
