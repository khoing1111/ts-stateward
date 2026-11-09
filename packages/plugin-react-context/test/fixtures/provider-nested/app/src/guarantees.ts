import { createContext, type Context } from "react";

export type RequiredContext<T> = Context<T> & { readonly "__guarantee:required-context"?: true };
export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };

export function requiredContext<T>(): RequiredContext<T> {
  return createContext<T>(undefined as never);
}
