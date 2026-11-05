import { useReducer } from "react";
import { initialCheckout } from "./initial.js";
import { checkoutReducer } from "./reducer.js";

export function CheckoutPage() {
  const [checkout, dispatch] = useReducer(checkoutReducer, initialCheckout);
  return (
    <button onClick={() => dispatch({ type: "cancel" })}>{checkout.status}</button>
  );
}
