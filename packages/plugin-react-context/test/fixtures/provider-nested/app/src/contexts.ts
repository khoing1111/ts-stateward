import { createContext, type Context } from "react";
import { requiredContext, type RequiredContext, type SingleProvider } from "./guarantees";

export type Store = { items: string[] };
export type Session = { user: string };
export type Cache = { size: number };

// Stated alone, with no default.
export const StoreContext: Context<Store | undefined> & SingleProvider = createContext<
  Store | undefined
>(undefined);

// Stated with RequiredContext, side by side.
export const SessionContext: RequiredContext<Session> & SingleProvider =
  requiredContext<Session>();

// Stated on a context with a default value.
export const CacheContext: Context<Cache> & SingleProvider = createContext<Cache>({ size: 0 });

// Not stated: nested Providers are fine.
export const ThemeContext = createContext<"light" | "dark">("light");
