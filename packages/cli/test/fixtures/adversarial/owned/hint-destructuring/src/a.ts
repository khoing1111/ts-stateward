import { session } from "./session.js";

export function signIn(): void {
  [session.user] = ["x"];
}
