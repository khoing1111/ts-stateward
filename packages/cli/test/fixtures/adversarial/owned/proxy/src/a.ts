import { session } from "./session.js";

export function rename(): void {
  const proxy = new Proxy(session, {});
  proxy.user = "p";
}
