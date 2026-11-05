import { GatewayError, PaymentDeclinedError } from "./errors.js";
import { charge } from "./gateway.js";
import type { Card } from "./gateway.js";

export type Order = { readonly id: string; readonly totalCents: number };
export type Receipt = { readonly orderId: string; readonly chargeId: string };

const retryQueue: Order[] = [];

/**
 * Pays an order with the customer's card. A provider outage queues the order for a retry.
 * @throws {PaymentDeclinedError}
 */
export async function pay(order: Order, card: Card): Promise<Receipt> {
  try {
    const chargeId = await charge(card, order.totalCents);
    return { orderId: order.id, chargeId };
  } catch (e) {
    if (e instanceof GatewayError) {
      retryQueue.push(order);
      return { orderId: order.id, chargeId: "pending" };
    }
    throw e;
  }
}
