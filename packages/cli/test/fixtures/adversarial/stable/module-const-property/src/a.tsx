import type { ReactNode } from "react";
import { ActionsContext, type Actions } from "./contexts.js";

const holder: { current: Actions } = { current: { save: () => undefined } };

export function swap(): void {
  holder.current = { save: () => undefined };
}

export function App({ children }: { children: ReactNode }) {
  return <ActionsContext.Provider value={holder.current}>{children}</ActionsContext.Provider>;
}
