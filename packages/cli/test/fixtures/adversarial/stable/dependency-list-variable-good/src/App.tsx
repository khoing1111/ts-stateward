import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children }: { children: ReactNode }) {
  const [, setCount] = useState(0);
  const save = useCallback(() => setCount(1), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
