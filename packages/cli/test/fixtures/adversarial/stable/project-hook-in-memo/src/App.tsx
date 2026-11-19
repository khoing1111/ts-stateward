import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
function useCounter(): number {
  const [n] = useState(0);
  return n;
}

export function App({ children }: { children: ReactNode }) {
  const n = useCounter();
  const value = useMemo(() => ({ save: () => console.log(n) }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
