import { session } from "./session.js";

export class View {
  get value() {
    return session;
  }
}
