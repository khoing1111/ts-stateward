declare const input: unknown;
declare const text: string;

type Plain = { id: string };
type Pair<T> = { left: T; right: T };

export const a = input as string;
export const b = input as Plain;
export const c = input as Pair<number>;
export const d = ["a", "b"] as const;
export const e = input as unknown;
export const f = <string>text;
export const g = input as readonly string[];
export const h = input as { readonly [key: string]: number };
