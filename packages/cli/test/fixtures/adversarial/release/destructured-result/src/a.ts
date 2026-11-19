import type { Release } from "./guarantees.js";

export function on(_event: string): Release<{ off(): void }> {
  return { off() {} };
}

export function start(): void {
  const { off } = on("a");
  void off;
}
