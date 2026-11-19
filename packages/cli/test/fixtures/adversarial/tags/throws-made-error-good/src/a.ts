import { AErr, BErr } from "./errors.js";

/** @throws {AErr | BErr} */
export function made(): void {
  if (Math.random() > 0.5) throw new AErr("a");
  throw new BErr("made");
}
