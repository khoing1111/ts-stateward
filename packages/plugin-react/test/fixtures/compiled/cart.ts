import { useCallback, useState } from "react";
import { api, type Item } from "./api.js";

export function useCart() {
  const [items, setItems] = useState<Item[]>([]);
  const addItem = useCallback((item: Item) => {
    setItems((current) => [...current, item]);
  }, []);
  const onSave = () => api.save(items);
  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };
  const summary = { count: items.length, total: items.reduce((sum, item) => sum + item.price, 0) };
  function clear() {
    setItems([]);
  }
  const count = items.length;
  return { items, addItem, onSave, removeItem, summary, clear, count };
}
