import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export class Saver {
  saving: Pending<boolean> = false;

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await post();
    } finally {
      this.saving = false;
    }
  }
}
