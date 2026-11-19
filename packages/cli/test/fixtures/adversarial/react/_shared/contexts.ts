import { createContext, type Context } from "react";
import type { SingleProvider, Stable } from "./guarantees.js";

export const ActionsContext: Context<{ save: () => void }> & Stable = createContext({
  save: () => undefined,
});
export const StoreContext: Context<{ n: number } | undefined> & SingleProvider = createContext<
  { n: number } | undefined
>(undefined);
