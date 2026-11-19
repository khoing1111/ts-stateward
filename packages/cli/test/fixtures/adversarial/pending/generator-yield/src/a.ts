import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;

  *save(): Generator<string, void, unknown> {
    this.saving = true;
    yield "saving";
    this.saving = false;
  }
}
