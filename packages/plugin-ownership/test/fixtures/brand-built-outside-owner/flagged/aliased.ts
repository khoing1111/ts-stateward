import type { Positive as Pos } from "./values.js";
import type * as v from "./values.js";
import type { Cents as Money } from "./money.js";
import type { Cents } from "./reexport.js";
import type { Id } from "./reexport.js";

declare const input: number;
declare const text: string;

export const a = input as Pos;
export const b = input as v.Positive;
export const c = input as Money;
export const d = input as Cents;
export const e = text as Id;
