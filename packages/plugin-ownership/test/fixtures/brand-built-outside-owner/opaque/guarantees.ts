// Stated guarantees: types that say what the code promises, so stateward proves it.
export type Opaque<T, Name extends string> = T & { readonly "__guarantee:opaque"?: Name };
