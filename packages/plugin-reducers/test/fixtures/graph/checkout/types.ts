export type Item = { sku: string; quantity: number };
export type Address = { street: string; city: string };

/** @final "paid" | "cancelled" */
export type CheckoutState =
  | { status: "cart"; items: Item[] }
  | { status: "review"; items: Item[]; address: Address }
  | { status: "paying"; items: Item[]; address: Address }
  | { status: "paymentFailed"; items: Item[]; address: Address; reason: string }
  | { status: "paid"; orderId: string }
  | { status: "cancelled" };

export type CheckoutEvent =
  | { type: "submitAddress"; address: Address }
  | { type: "paymentFailed"; reason: string }
  | { type: "paymentSucceeded"; orderId: string }
  | { type: "cancel" };
