import { useState } from "react";
import type { OrderId } from "./order-id.js";

export function useSelection() {
  const [selected, setSelected] = useState<OrderId | null>("bad");
  return { selected, setSelected };
}
