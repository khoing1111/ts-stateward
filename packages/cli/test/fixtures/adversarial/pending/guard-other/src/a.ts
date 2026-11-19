import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  form = { saving: false };

  async run(): Promise<void> {
    if (this.form.saving) return;
    this.saving = true;
    try {
      await post();
    } finally {
      this.saving = false;
    }
  }
}
