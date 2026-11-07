import { createContext, type Context } from "react";

export type RequiredContext<T> = Context<T> & { readonly __guarantee?: "required-context" };

export function requiredContext<T>(): RequiredContext<T> {
  return createContext<T>(undefined as never);
}
