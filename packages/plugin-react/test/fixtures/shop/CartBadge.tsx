import { useCallback, useEffect, useMemo } from "react";
import { useCart } from "./cart.js";

export function CartBadge() {
  const cart = useCart();
  useEffect(() => {
    const timer = setInterval(() => void cart.onSave(), 5000);
    return () => clearInterval(timer);
  }, [cart.onSave]);
  const reset = useCallback(() => cart.clear(), [cart.clear]);
  const label = useMemo(() => `${String(cart.summary.count)} items`, [cart.summary]);
  return <button onClick={reset}>{label}</button>;
}
