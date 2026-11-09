// Stated guarantees: types that say what the code promises, so stateward proves it.
export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };
