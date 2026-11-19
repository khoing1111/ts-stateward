import { session } from "./session.js";

export class Panel {
  s = session;
  reset(): void {
    this.s.user = "dark";
  }
}
