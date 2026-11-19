import { session } from "./session.js";

export class View {
  get count(): number {
    return session.count;
  }
}
