import type { ReactNode } from "react";
import type { OrderId } from "./order-id.js";

function Show({ id }: { id: OrderId }): ReactNode {
  return <p>{id}</p>;
}

export function Page(): ReactNode {
  const props = { id: "o-1" };
  return <Show {...props} />;
}
