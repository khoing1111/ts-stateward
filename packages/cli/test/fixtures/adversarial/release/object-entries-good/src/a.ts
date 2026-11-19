import { watchPrices } from "./prices.js";
export function f(o: Record<string, number>): number { const stop = watchPrices(() => undefined); const n = Object.entries(o).length; stop(); return n; }
