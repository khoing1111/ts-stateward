export class AErr extends Error {}
class Cfg {
  readonly port = 1;
}
export const cfg = new Cfg();

/** @throws {AErr} */
export function port(): number {
  if (cfg.port < 0) throw new AErr("x");
  return cfg.port;
}
