import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
const current = 1;

export function App({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ save: () => console.log(current) }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
