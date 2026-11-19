import { orderId, type OrderId } from "./order-id.js";

class Base {
  idField: OrderId | undefined = orderId("o-1");
}

export class Sub extends Base {
  override idField = orderId("o-2");
}
