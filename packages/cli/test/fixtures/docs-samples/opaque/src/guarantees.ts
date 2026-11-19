export type Opaque<T, Name extends string> = T & { readonly "__guarantee:opaque"?: Name };
