import { session } from "./session.js";

export function signedOut(): void {
  [session.user] = [null];
}
