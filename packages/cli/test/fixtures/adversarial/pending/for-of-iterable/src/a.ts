import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  total = 0;

  run(items: Iterable<number>): void {
    this.saving = true;
    for (const x of items) this.total += x;
    this.saving = false;
  }
}
