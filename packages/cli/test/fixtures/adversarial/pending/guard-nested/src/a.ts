import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;

  async run(quick: boolean): Promise<void> {
    if (quick) {
      if (this.saving) return;
    }
    this.saving = true;
    try {
      await post();
    } finally {
      this.saving = false;
    }
  }
}
