import { session } from "./session.js";

export class Panel {
  count(): number {
    return session.count;
  }
}
