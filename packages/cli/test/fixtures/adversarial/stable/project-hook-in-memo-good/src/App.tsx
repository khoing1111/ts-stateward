import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children }: { children: ReactNode }) {
  const counter = useRef(0);
  const value = useMemo(() => ({ save: () => console.log(counter.current) }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
