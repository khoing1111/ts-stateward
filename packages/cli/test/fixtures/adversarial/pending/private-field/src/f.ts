import type { Pending } from "./guarantees.js";
import { post } from "./api.js";

export class Saver {
  #saving: Pending<boolean> = false;

  get saving(): boolean {
    return this.#saving;
  }

  async save(): Promise<void> {
    if (this.#saving) return;
    this.#saving = true;
    await post();
    this.#saving = false;
  }
}
