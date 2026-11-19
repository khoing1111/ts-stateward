import type { Release } from "./guarantees.js";

export function on(_event: string): Release<() => void> {
  return () => undefined;
}

export function start(): Array<() => void> {
  return ["a"].map(on);
}
