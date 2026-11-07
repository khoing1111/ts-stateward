import type { Owned } from "./guarantees.js";

/** Stated owned, but nothing changes it: a marker with nothing to prove. */
export const flags: Owned<{ beta: boolean }> = { beta: false };
