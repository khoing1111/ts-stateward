import { createContext, type Context } from "react";
import type { SingleProvider, Stable } from "./guarantees";

export type Store = { items: string[] };

export const StoreContext: Context<Store | null> & SingleProvider & Stable = createContext<Store | null>(null);
export const ModeContext: Context<string> & Stable = createContext("light");
