import type { Owned } from "./guarantees.js";

export class Store {
  static items: Owned<string[]> = [];

  static add(item: string): void {
    Store.items.push(item);
    this.items.sort();
  }
}

export let count: Owned<number> = 0;

export function increment(): void {
  count += 1;
}

export const jobs: Owned<{ done: boolean }[]> = [];

export function finishAll(): void {
  for (const job of jobs) job.done = true;
}
