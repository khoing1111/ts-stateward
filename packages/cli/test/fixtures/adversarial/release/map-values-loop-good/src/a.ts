import { watchPrices } from "./prices.js";
export function f(m: Map<string, number>): number { const stop = watchPrices(() => undefined); let t = 0; for (const v of m.values()) t += v; stop(); return t; }
