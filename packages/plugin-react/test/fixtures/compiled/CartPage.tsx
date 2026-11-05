import { useEffect } from "react";
import { useCart } from "./cart.js";

export function CartPage() {
  const { onSave, items, addItem, count } = useCart();
  useEffect(() => {
    void onSave();
  }, [onSave]);
  useEffect(() => {
    document.title = `${String(count)} items`;
  }, [items, addItem, count]);
  return <p>{items.length}</p>;
}
