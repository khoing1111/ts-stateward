import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export class Saver {
  saving: Pending<boolean> = false;

  async save(): Promise<void> {
    if (this.saving) return;
    Object.assign(this, { saving: true });
    await post();
    this.saving = false;
  }
}
