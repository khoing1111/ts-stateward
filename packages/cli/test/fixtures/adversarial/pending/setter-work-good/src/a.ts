import type { Pending } from "./guarantees.js";

declare function post(): Promise<string>;

export class S {
  saving: Pending<boolean> = false;
  #v = 0;

  set value(v: number) {
    if (v < 0) throw new RangeError("neg");
    this.#v = v;
  }

  get value(): number {
    return this.#v;
  }

  run(v: number): void {
    this.saving = true;
    try {
      this.value = v;
    } finally {
      this.saving = false;
    }
  }
}
