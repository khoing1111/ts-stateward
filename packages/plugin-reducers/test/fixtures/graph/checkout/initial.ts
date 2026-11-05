import type { CheckoutState } from "./types.js";

// The annotation hides the tag: stateward follows the constant to its initializer.
export const initialCheckout: CheckoutState = { status: "cart", items: [] };
