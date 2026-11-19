import { session } from "./session.js";

export function rename(): void {
  const proxy = new Proxy({ count: session.count }, {});
  proxy.count = 1;
}
