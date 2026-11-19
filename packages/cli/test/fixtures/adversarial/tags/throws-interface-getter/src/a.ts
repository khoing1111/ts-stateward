export class AErr extends Error {}
interface Cfg {
  readonly port: number;
}
class Live implements Cfg {
  get port(): number {
    throw new TypeError("x");
  }
}
export const cfg: Cfg = new Live();

/** @throws {AErr} */
export function port(): number {
  if (cfg.port < 0) throw new AErr("x");
  return cfg.port;
}
