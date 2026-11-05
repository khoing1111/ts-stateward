import { assertNotExpired } from "./card.js";
import { PaymentDeclinedError } from "./errors.js";
import type { Card } from "./gateway.js";
import { pay } from "./payment.js";
import type { Order, Receipt } from "./payment.js";

export type CheckoutResult =
  | { readonly kind: "paid"; readonly receipt: Receipt }
  | { readonly kind: "declined"; readonly reason: string };

export async function checkout(order: Order, card: Card): Promise<CheckoutResult> {
  try {
    const receipt = await pay(order, card);
    return { kind: "paid", receipt };
  } catch (e) {
    if (e instanceof PaymentDeclinedError) {
      return { kind: "declined", reason: e.reason };
    }
    throw e;
  }
}

/**
 * Buys the same order again with one click; the page shows why a card was declined.
 * @throws {PaymentDeclinedError}
 */
export async function buyAgain(order: Order, card: Card): Promise<Receipt> {
  return await pay(order, card);
}

export async function renew(order: Order, card: Card): Promise<Receipt> {
  const receipt = await pay(order, card);
  return receipt;
}

export async function payWithToast(
  order: Order,
  card: Card,
  toast: (text: string) => void,
): Promise<void> {
  try {
    await pay(order, card);
    toast("Paid, thank you.");
  } catch {
    toast("Something went wrong, please try again.");
  }
}

export async function payOrShowError(
  order: Order,
  card: Card,
  setError: (message: string) => void,
): Promise<void> {
  try {
    await pay(order, card);
  } catch (e) {
    if (e instanceof Error) {
      setError(e.message);
    } else {
      throw e;
    }
  }
}

/**
 * Pays, and sends any failure to the error tracker.
 */
export async function payAndReport(
  order: Order,
  card: Card,
  report: (error: unknown) => void,
): Promise<Receipt> {
  try {
    return await pay(order, card);
  } catch (e) {
    report(e);
    throw e;
  }
}

export function canPayWith(card: Card, today: string): boolean {
  try {
    assertNotExpired(card, today);
    return true;
  } catch (e) {
    if (e instanceof PaymentDeclinedError) return false;
    throw e;
  }
}

/** The label of the pay button. */
export function payButtonLabel(card: Card, today: string): string {
  assertNotExpired(card, today);
  return `Pay with the card ending ${card.number.slice(-4)}`;
}

export function onPayClicked(
  order: Order,
  card: Card,
  listen: (handler: () => Promise<void>) => void,
): void {
  listen(async () => {
    await pay(order, card);
  });
}
