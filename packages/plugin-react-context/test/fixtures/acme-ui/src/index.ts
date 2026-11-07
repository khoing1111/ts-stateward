// Another package of the monorepo, outside the files the fixture checks.
import { createContext, type Context } from "react";

export type RequiredContext<T> = Context<T> & { readonly __guarantee?: "required-context" };
export type Theme = { dark: boolean };

export const ThemeCtx: RequiredContext<Theme> = createContext<Theme>(undefined as never);
