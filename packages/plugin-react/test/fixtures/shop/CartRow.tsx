import { memo } from "react";
import type { Item } from "./api.js";

export const CartRow = memo(function CartRow({
  item,
  onRemove,
  onAdd,
}: {
  item: Item;
  onRemove: (id: string) => void;
  onAdd: (item: Item) => void;
}) {
  return (
    <li>
      {item.name}
      <button onClick={() => onRemove(item.id)}>remove</button>
      <button onClick={() => onAdd(item)}>again</button>
    </li>
  );
});
