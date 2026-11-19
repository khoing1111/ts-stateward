import type { Release } from "./guarantees.js";

export function on(_event: string): Release<() => void> {
  return () => undefined;
}

export function start(): void {
  const off = on("a");
  off();
}
