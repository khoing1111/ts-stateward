import type { Brand } from "./brand.js";
import type { Int, NonEmptyArray, NonEmptyString, NonNegative, Positive } from "./values.js";

declare const input: number;
declare const text: string;
declare const list: readonly number[];

export const a = input as Positive;
export const b = <Positive>input;
export const c = input as unknown as Positive;
export const d = input as NonNegative;
export const e = input as Int;
export const g = text as NonEmptyString;
export const h = list as NonEmptyArray<number>;
// The helper written inline names no brand with an owner: not reported.
export const i = text as Brand<string, "Raw">;
export const j = input as Positive & Int;
export const k = (input as Positive) + 1;
export const l = input as (Int);
