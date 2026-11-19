export type Release<T = unknown> = T & { readonly "__guarantee:release"?: true };
