import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  data: unknown;

  async run(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.data = await post()
      .then((r): unknown => JSON.parse(r))
      .catch(() => {
        this.saving = false;
        return {};
      });
    this.saving = false;
  }
}
