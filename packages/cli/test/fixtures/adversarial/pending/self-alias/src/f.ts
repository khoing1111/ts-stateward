import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export class Saver {
  saving: Pending<boolean> = false;

  async save(): Promise<void> {
    if (this.saving) return;
    const self = this;
    self.saving = true;
    await post();
    self.saving = false;
  }
}
