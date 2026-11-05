import type { Cents } from "./money.js";
import type { LocalQty } from "./alias-local.js";

declare const input: number;

type Money = Cents;
type Parenthesized = (Cents);

// Neither alias file owns its brand: the first points at values.ts, the others at money.ts.
export const a = input as LocalQty;
export const b = input as Money;
export const c = input as Parenthesized;
