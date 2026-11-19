import { useMemo } from "react";
import { ActionsContext } from "./contexts.js";

declare function post(): Promise<void>;

export function App({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => ({ save: () => void post() }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
