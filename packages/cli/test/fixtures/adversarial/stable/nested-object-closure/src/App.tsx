import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children, onSave }: { children: ReactNode; onSave: (user: string) => void }) {
  const handlers = { save: () => onSave("x") };
  const save = useCallback(() => handlers.save(), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
