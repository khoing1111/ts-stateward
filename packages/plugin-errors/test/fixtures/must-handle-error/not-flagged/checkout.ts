import { assertNotExpired } from "./card.js";
import { CardExpiredError, PaymentDeclinedError } from "./errors.js";
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
export const buyAgain = async (order: Order, card: Card): Promise<Receipt> => {
  return await pay(order, card);
};

/**
 * Pays, and sends any failure to the error tracker.
 * @throws {PaymentDeclinedError}
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

export function expiredCards(cards: readonly Card[], today: string): Card[] {
  const expired: Card[] = [];
  cards.forEach((card) => {
    try {
      assertNotExpired(card, today);
    } catch (e) {
      if (e instanceof CardExpiredError) expired.push(card);
      else throw e;
    }
  });
  return expired;
}
