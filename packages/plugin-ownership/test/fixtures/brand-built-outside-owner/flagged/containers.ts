import type { Cents } from "./money.js";
import type { Positive } from "./values.js";

declare const input: number;
declare const unknownValue: unknown;

export const a = input as Positive | undefined;
export const b = [input] as Positive[];
export const c = [input] as readonly Positive[];
export const d = [input] as Array<Positive>;
export const e = unknownValue as { qty: Positive };
export const f = unknownValue as [string, Cents];
export const g = unknownValue as { readonly price?: Cents } | null;
export const h = unknownValue as [label: string, ...rest: Positive[]];
