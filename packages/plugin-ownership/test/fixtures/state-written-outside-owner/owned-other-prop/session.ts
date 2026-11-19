import type { Owned } from "./guarantees.js";

export const session: Owned<{ user: string | null; tags: string[] }> = { user: null, tags: [] };

export function signOut(): void {
  session.user = null;
}
