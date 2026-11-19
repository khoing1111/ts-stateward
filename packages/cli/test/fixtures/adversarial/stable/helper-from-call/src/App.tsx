import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
import { makeHelper } from "./make.js";

export function App({ children, onSave }: { children: ReactNode; onSave: (user: string) => void }) {
  const helper = makeHelper(onSave);
  const save = useCallback(() => helper(), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
