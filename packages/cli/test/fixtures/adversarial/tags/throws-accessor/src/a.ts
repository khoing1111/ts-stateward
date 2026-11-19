import { AErr, type Box } from "./errors.js";

/** @throws {AErr} */
export function read(box: Box): number {
  if (Math.random() > 0.5) throw new AErr("a");
  return box.value;
}

/** @throws {AErr} */
export function write(box: Box): void {
  if (Math.random() > 0.5) throw new AErr("a");
  box.value = 1;
}
