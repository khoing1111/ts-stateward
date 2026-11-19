import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;
  failed = false;

  save(): void {
    this.saving = true;
    void fetch("/save").then(
      () => {
        this.saving = false;
      },
      () => {
        this.failed = true;
      },
    );
  }
}
