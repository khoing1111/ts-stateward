import { session } from "./session.js";

export function signIn(name: string): void {
  session.user = name;
}
