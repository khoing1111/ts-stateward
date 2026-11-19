import { orderId, type OrderId } from "./order-id.js";

export class O {
  id: OrderId | undefined = orderId("o-1");

  rename(s: string): void {
    if (this.id !== undefined) this.id += s;
  }
}
