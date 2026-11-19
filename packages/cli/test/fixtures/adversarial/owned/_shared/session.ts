import type { Owned } from "./guarantees.js";

export const session: Owned<{
  user: string | null;
  count: number;
  tags: string[];
  meta: { n: number };
}> = { user: null, count: 0, tags: [], meta: { n: 0 } };

export function signOut(): void {
  session.user = null;
}
