import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  total = 0;

  run(items: Iterable<number>): void {
    this.saving = true;
    try {
      for (const x of items) this.total += x;
    } finally {
      this.saving = false;
    }
  }
}
