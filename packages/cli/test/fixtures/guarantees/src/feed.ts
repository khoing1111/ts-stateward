import type { Release } from "./guarantees";

export function watchFeed(onItem: (item: string) => void): Release<() => void> {
  const id = setInterval(() => onItem("tick"), 1000);
  return () => clearInterval(id);
}

export function followFeed(onItem: (item: string) => void): () => void {
  const stop = watchFeed(onItem);
  return stop;
}
