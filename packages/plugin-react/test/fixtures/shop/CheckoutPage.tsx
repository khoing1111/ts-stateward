import { useEffect } from "react";
import { useCheckout } from "./checkout.js";

export function CheckoutPage() {
  const { save, count } = useCheckout();
  useEffect(() => {
    if (count > 0) void save();
  }, [save, count]);
  return <p>{count}</p>;
}
