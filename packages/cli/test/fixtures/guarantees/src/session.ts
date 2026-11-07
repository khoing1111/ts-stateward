import type { Owned } from "./guarantees";

export const session: Owned<{ user: string | null }> = { user: null };

export function signOut(): void {
  session.user = null;
}
