import { useState } from "react";
import type { OrderId } from "./order-id.js";

export function useSelection() {
  const [selected, setSelected] = useState<OrderId | null>(null);
  const seen = new Map<OrderId, number>();
  return { selected, setSelected, seen };
}
