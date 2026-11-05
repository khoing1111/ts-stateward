/**
 * The card issuer refused the payment.
 * @mustHandle Tell the user the card was declined and let them pick another card.
 */
export class PaymentDeclinedError extends Error {
  constructor(readonly reason: string) {
    super(`Payment declined: ${reason}`);
    this.name = "PaymentDeclinedError";
  }
}

/** A declined payment the user fixes by updating the card's expiry date. */
export class CardExpiredError extends PaymentDeclinedError {
  constructor(readonly expires: string) {
    super(`the card expired on ${expires}`);
    this.name = "CardExpiredError";
  }
}

/** The payment provider did not answer: safe to retry later. */
export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}
