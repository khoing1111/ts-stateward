import type { ReactNode } from "react";
import { orderId, type OrderId } from "./order-id.js";

function Show({ id }: { id: OrderId }): ReactNode {
  return <p>{id}</p>;
}

export function Page(): ReactNode {
  const id = orderId("o-1");
  if (id === undefined) return null;
  const props = { id };
  return <Show {...props} />;
}
