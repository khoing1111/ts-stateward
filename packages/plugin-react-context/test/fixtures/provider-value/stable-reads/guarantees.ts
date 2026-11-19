export type Stable<T = unknown> = T & { readonly "__guarantee:stable"?: true };
