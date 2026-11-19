import { AErr } from "./errors.js";

/** @throws {AErr} */
export function steps(): number[] {
  if (Math.random() > 0.5) throw new AErr("a");
  return [1];
}
