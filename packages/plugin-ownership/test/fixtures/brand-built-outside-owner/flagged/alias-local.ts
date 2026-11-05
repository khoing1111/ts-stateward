import type { Positive } from "./values.js";

declare const input: number;

// A local alias of a brand declares nothing: the brand's owner is still values.ts.
export type LocalQty = Positive;
export const a = input as LocalQty;
