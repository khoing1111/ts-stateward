import { createContext, type Context } from "react";
export type Owned<T = unknown> = T & { readonly "__guarantee:owned"?: true };
export type Release<T = unknown> = T & { readonly "__guarantee:release"?: true };
export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };
export type Stable<T = unknown> = T & { readonly "__guarantee:stable"?: true };
export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };
export type Pending<T, Running extends T = Extract<T, true>> = T & {
  readonly "__guarantee:pending"?: Running;
};
export type Opaque<T, Name extends string> = T & { readonly "__guarantee:opaque"?: Name };
export type RequiredContext<T> = Context<T> & { readonly "__guarantee:required-context"?: true };
export function requiredContext<T>(): RequiredContext<T> {
  return createContext<T>(undefined as never);
}
