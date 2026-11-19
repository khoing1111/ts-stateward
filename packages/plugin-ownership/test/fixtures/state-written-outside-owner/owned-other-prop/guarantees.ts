export type Owned<T> = T & { readonly __guarantee?: "owned" };
