declare const brand: unique symbol;

/** The project's own brand helper: a building block, not a brand, so nobody owns it. */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };
