import { AErr, failB } from "./errors.js";

/** @throws {AErr} */
export function* steps(): Generator<number> {
  if (Math.random() > 0.5) throw new AErr("a");
  yield 1;
  failB();
}
