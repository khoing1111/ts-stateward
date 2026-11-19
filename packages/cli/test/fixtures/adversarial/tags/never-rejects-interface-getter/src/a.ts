interface Cfg {
  readonly port: number;
}
class Live implements Cfg {
  get port(): number {
    throw new TypeError("x");
  }
}
export const cfg: Cfg = new Live();

/** @neverRejects */
export async function port(): Promise<number> {
  return cfg.port;
}
