import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;

  run(): void {
    this.saving = true;
    void post().finally(() => {
      this.saving = false;
    });
  }
}
