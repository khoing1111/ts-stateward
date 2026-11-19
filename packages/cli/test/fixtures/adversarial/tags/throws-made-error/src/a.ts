import { AErr, makeB } from "./errors.js";

/** @throws {AErr} */
export function made(): void {
  if (Math.random() > 0.5) throw new AErr("a");
  throw makeB();
}
