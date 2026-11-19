import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children }: { children: ReactNode }) {
  const [, setUser] = useState("ann");
  const helper = () => setUser("bob");
  const save = useCallback(() => helper(), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
