import { AErr, BErr } from "./errors.js";

/** @throws {AErr | BErr} */
export function held(): void {
  if (Math.random() > 0.5) throw new AErr("a");
  const error = new BErr("held");
  throw error;
}

/** @throws {AErr | BErr} */
export function assigned(): void {
  if (Math.random() > 0.5) throw new AErr("a");
  throw Object.assign(new BErr("assigned"), { code: 1 });
}
