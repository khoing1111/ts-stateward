import { Declined, Expired } from "./errors.js";

declare function toast(text: string): void;

/** the app's error helper names the marked class first thing. */
export function showPaymentError(error: unknown): void {
  if (error instanceof Declined) {
    toast("Your card was declined: pick another card.");
    return;
  }
  toast("Something went wrong.");
}

/** A helper that names a subclass and the class, as an arrow. */
export const showRenewal = (error: unknown): void => {
  if (error instanceof Expired || error instanceof Declined) toast("Renew your card.");
};
