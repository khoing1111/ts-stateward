import { AErr, BErr, failB } from "./errors.js";

/** @throws {AErr | BErr} */
export function viaCall(): void {
  if (Math.random() > 0.5) throw new AErr("a");
  failB.call(null);
}

export class Job {
  /** @throws {AErr | BErr} */
  run(): void {
    if (Math.random() > 0.5) throw new AErr("a");
    throw new BErr("job");
  }
}
