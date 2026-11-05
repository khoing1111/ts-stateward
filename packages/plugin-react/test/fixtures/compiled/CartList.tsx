import { useCart } from "./cart.js";
import { CartRow } from "./CartRow.js";

export function CartList() {
  const { items, removeItem, addItem } = useCart();
  return (
    <ul>
      {items.map((item) => (
        <CartRow key={item.id} item={item} onRemove={removeItem} onAdd={addItem} />
      ))}
    </ul>
  );
}
