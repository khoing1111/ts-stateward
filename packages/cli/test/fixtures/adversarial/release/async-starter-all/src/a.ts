import type { Release } from "./guarantees.js";

export async function on(_event: string): Promise<Release<() => void>> {
  return () => undefined;
}

export async function start(): Promise<void> {
  await Promise.all([on("x"), on("y")]);
}
