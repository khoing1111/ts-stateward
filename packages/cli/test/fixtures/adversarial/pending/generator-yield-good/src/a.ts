import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;

  *save(): Generator<string, void, unknown> {
    if (this.saving) return;
    this.saving = true;
    try {
      yield "saving";
    } finally {
      this.saving = false;
    }
  }
}
