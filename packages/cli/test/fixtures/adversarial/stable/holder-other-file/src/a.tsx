import type { ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
import { holder } from "./holder.js";

export function App({ children }: { children: ReactNode }) {
  return <ActionsContext.Provider value={holder.current}>{children}</ActionsContext.Provider>;
}
