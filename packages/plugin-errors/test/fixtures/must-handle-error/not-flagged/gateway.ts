import { GatewayError, PaymentDeclinedError } from "./errors.js";

export type Card = { readonly number: string; readonly expires: string };

export type GatewayReply =
  | { readonly status: "approved"; readonly chargeId: string }
  | { readonly status: "declined"; readonly reason: string }
  | { readonly status: "unavailable" };

/** The payment provider's client; tests replace it. */
export const provider = {
  async submit(card: Card, cents: number): Promise<GatewayReply> {
    if (cents <= 0) return { status: "unavailable" };
    return card.number.endsWith("0000")
      ? { status: "declined", reason: "insufficient funds" }
      : { status: "approved", chargeId: `ch_${String(cents)}` };
  },
};

/** Charges the card and returns the provider's charge id. */
export async function charge(card: Card, cents: number): Promise<string> {
  const reply = await provider.submit(card, cents);
  switch (reply.status) {
    case "approved":
      return reply.chargeId;
    case "declined":
      throw new PaymentDeclinedError(reply.reason);
    case "unavailable":
      throw new GatewayError("the payment provider is unavailable");
  }
}
