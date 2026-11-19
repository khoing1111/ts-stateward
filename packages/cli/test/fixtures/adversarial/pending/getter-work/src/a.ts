import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  n = 0;

  get total(): number {
    if (this.n < 0) throw new Error("bad");
    return this.n;
  }

  run(): number {
    let t = 0;
    this.saving = true;
    t = this.total;
    this.saving = false;
    return t;
  }
}
