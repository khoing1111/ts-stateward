import type { Brand } from "./brand.js";
import { cents, type Cents } from "./money.js";
import { positive, toPercent, type Positive } from "./values.js";

declare const input: number;
declare const text: string;

// A brand declared here, with its constructor: the cast is the owner's.
export type Sku = Brand<string, "Sku">;
export function sku(value: string): Sku | undefined {
  return /^[A-Z]{3}-\d{4}$/.test(value) ? (value as Sku) : undefined;
}

export const qty = positive(input);
export const pct = toPercent(input);
export const code = sku(text);
export const price: Cents = cents(input);
export const widened: number = (qty ?? 0) satisfies number;

export function charge(amount: Positive): Positive {
  return amount;
}
