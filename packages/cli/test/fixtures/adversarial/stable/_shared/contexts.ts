import { createContext, type Context } from "react";
import type { Stable } from "./guarantees.js";

export type Actions = { save: () => void };

export const ActionsContext: Context<Actions> & Stable = createContext<Actions>({
  save: () => undefined,
});
