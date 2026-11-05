import { memo } from "react";
import type { Item } from "./api.js";
import { useCart } from "./cart.js";

/** Compares only `item`: a new `onRemove` each render does not re-render it. Silent. */
export const ComparedRow = memo(
  function ComparedRow({ item, onRemove }: { item: Item; onRemove: (id: string) => void }) {
    return <li onClick={() => onRemove(item.id)}>{item.name}</li>;
  },
  (before, after) => before.item === after.item,
);

export function ComparedList() {
  const { items, removeItem } = useCart();
  return (
    <ul>
      {items.map((item) => (
        <ComparedRow key={item.id} item={item} onRemove={removeItem} />
      ))}
    </ul>
  );
}
