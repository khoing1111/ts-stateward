import type { Release } from "./guarantees.js";

export function on(_event: string): Release<() => void> {
  return () => undefined;
}

export function start(): void {
  const x = on("x");
  try {
    const y = on("y");
    y();
  } finally {
    x();
  }
}
