import type { Brand } from "./brand.js";

export type Cents = Brand<number, "Cents">;

// The owner of Cents: casts are allowed here, in every form.
export function cents(amount: number): Cents {
  return amount as Cents;
}

export function centsAgain(amount: number): Cents {
  return <Cents>amount;
}

export function viaUnknown(amount: number): Cents {
  return amount as unknown as Cents;
}

export const total = (1 as Cents) + (2 as Cents);

// Aliases of its own brand and predicates about it stay in the owner.
export type Money = Cents;
export const money = 3 as Money;
export function isCents(value: number): value is Cents {
  return value >= 0;
}
