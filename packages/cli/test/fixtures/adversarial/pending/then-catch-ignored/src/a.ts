import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;

  save(): void {
    this.saving = true;
    fetch("/save")
      .then(() => {
        this.saving = false;
      })
      .catch(() => undefined);
  }
}
