import type { Brand } from "./brand.js";

export type Cents = Brand<number, "Cents">;

// The owner of Cents: a cast here is allowed.
export function cents(amount: number): Cents {
  return amount as Cents;
}
