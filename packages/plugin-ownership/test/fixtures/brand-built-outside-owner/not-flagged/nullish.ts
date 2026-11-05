import type { Positive } from "./values.js";

declare const prices: Map<string, Positive>;
declare const maybe: Positive | undefined;
declare const nullable: Positive | null | undefined;
declare const list: Positive[] | undefined;

// The source is already the brand: these casts only drop undefined or null.
export const a = prices.get("a") as Positive;
export const b = maybe as Positive;
export const c = nullable as Positive;
export const d = <Positive>maybe;
export const e = maybe as Positive | null;
export const f = list as Positive[];
