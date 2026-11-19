import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export class Saver {
  busy: Pending<boolean> = false;

  async save(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await post();
    } finally {
      this.busy = false;
    }
  }
}
