import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
declare function post(): Promise<void>;

export function App({ children }: { children: ReactNode }) {
  const saving = useRef(false);
  const save = useCallback(async (): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    await post();
    saving.current = false;
  }, []);
  const value = useMemo(() => ({ save: () => void save() }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
