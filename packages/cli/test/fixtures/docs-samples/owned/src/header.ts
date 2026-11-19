import { session } from "./session";

export function logOut(): void {
  const current = session;
  current.user = null;
}
