import { orderId, type OrderId } from "./order-id.js";

class Base {
  id(): OrderId | undefined {
    return orderId("o-1");
  }
}

export class Sub extends Base {
  override id() {
    return orderId("o-2");
  }
}
