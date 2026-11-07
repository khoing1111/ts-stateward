import type { Owned } from "./guarantees.js";

/** A local name for the marker: the guarantee is read from the type, not the name. */
export type Mine<T> = Owned<T>;

export const registry: Mine<Map<string, number>> = new Map();
