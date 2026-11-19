import type { Pending } from "./guarantees.js";

export class Form {
  saving: Pending<boolean> = false;
  data: unknown = null;

  load(text: string): void {
    this.saving = true;
    try {
      this.data = JSON.parse(text);
    } finally {
      this.saving = false;
    }
  }
}
