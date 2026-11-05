import { useState } from "react";

type ItemId = string;

export function useItems() {
  const [labels, setLabels] = useState<Record<ItemId, string>>({});
  const [counts, setCounts] = useState<Map<ItemId, number>>(new Map());

  const add = (id: ItemId, label: string) => {
    setLabels((prev) => ({ ...prev, [id]: label }));
    setCounts((prev) => new Map(prev).set(id, 0));
  };
  const remove = (id: ItemId) => {
    setLabels((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCounts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };
  return { labels, counts, add, remove };
}
