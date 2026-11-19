import { AErr } from "./errors.js";

/** @throws {AErr} */
export function read(box: { value: number }): number {
  if (Math.random() > 0.5) throw new AErr("a");
  return box.value;
}

/** @throws {AErr} */
export function write(box: { value: number }): void {
  if (Math.random() > 0.5) throw new AErr("a");
  box.value = 1;
}
