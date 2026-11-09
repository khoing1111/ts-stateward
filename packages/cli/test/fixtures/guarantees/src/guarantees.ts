import { createContext, type Context } from "react";

export type RequiredContext<T> = Context<T> & { readonly __guarantee?: "required-context" };

export function requiredContext<T>(): RequiredContext<T> {
  return createContext<T>(undefined as never);
}

export type Owned<T = unknown> = T & { readonly "__guarantee:owned"?: true };

export type Release<T = unknown> = T & { readonly "__guarantee:release"?: true };

export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };

export type Stable<T = unknown> = T & { readonly "__guarantee:stable"?: true };
