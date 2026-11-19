import { watchPrices } from "./prices.js";
import type { Opaque } from "./guarantees.js";
export type UserId = Opaque<string, "UserId">;
export function f(id: UserId): string { const stop = watchPrices(() => undefined); const key = id.toLowerCase(); stop(); return key; }
