export type Owned<T = unknown> = T & { readonly "__guarantee:owned"?: true };
