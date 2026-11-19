class Cfg {
  readonly port = 1;
}
export const cfg = new Cfg();

/** @neverRejects */
export async function port(): Promise<number> {
  return cfg.port;
}
