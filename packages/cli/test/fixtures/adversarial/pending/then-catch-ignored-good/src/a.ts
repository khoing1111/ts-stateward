import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;

  save(): void {
    if (this.saving) return;
    this.saving = true;
    fetch("/save")
      .catch(() => undefined)
      .finally(() => {
        this.saving = false;
      });
  }
}
