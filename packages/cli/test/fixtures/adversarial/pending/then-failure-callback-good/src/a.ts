import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;
  failed = false;

  save(): void {
    if (this.saving) return;
    this.saving = true;
    void fetch("/save").then(
      () => {
        this.saving = false;
      },
      () => {
        this.failed = true;
        this.saving = false;
      },
    );
  }
}
