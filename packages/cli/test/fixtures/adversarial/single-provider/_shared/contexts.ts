import { createContext, type Context } from "react";
import { requiredContext, type RequiredContext, type SingleProvider } from "./guarantees.js";

export type Store = { n: number };

export const StoreContext: Context<Store | undefined> & SingleProvider = createContext<
  Store | undefined
>(undefined);

export const ThemeContext: RequiredContext<{ color: string }> = requiredContext<{
  color: string;
}>();
