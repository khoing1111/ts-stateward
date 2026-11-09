import type { Release } from "./guarantees.js";

/** Stated `Release`: the name says nothing about a subscription. */
export function watchFeed(onItem: (item: string) => void): Release<() => void> {
  const id = setInterval(() => onItem("tick"), 1000);
  return () => clearInterval(id);
}

/** A standard `Disposable`. */
export class Socket implements Disposable {
  send(text: string): void {
    void text;
  }
  [Symbol.dispose](): void {}
}

export function connect(): Socket {
  return new Socket();
}
