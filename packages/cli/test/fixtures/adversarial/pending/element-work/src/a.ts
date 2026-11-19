import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  first = "";
  items: { name: string }[] = [];

  run(): void {
    this.saving = true;
    this.first = this.items[0].name;
    this.saving = false;
  }
}
