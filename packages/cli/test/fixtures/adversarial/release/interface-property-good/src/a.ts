import { watchPrices } from "./prices.js";
export interface Options { readonly limit: number }
export function f(opts: Options): number { const stop = watchPrices(() => undefined); const n = opts.limit * 2; stop(); return n; }
