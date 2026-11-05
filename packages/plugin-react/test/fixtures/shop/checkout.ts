import { useCart } from "./cart.js";

/** Hands `onSave` on under another name: the cause stays in `useCart`. */
export function useCheckout() {
  const { onSave, count } = useCart();
  return { save: onSave, count };
}
