// A brand cast in the file that declares it (its owner), and types that only look like brands: a
// plain alias named Positive, and a helper whose tag is a plain `string` property.
declare const tag: unique symbol;
export type Tag = string & { readonly [tag]: true };

type Positive = number;
type Brand<T> = T & { readonly tag: string };

declare const input: number;
declare const text: string;

export const a = text as Tag;
export const b = input as Positive;
export const c = text as Brand<string>;
