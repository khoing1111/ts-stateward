import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children, onSave }: { children: ReactNode; onSave: () => void }) {
  function handler(): void {
    onSave();
  }
  const save = useCallback(handler, []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
