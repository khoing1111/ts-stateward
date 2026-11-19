import { watchPrices } from "./prices.js";
class Strict extends Map<string, number> {
  override get(k: string): number {
    const v = super.get(k);
    if (v === undefined) throw new Error(k);
    return v;
  }
}
export const m: Map<string, number> = new Strict();

export function f(k: string): number | undefined {
  const stop = watchPrices(() => undefined);
  const v = m.get(k);
  stop();
  return v;
}
