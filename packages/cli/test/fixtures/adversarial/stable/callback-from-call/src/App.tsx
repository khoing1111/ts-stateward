import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
declare function debounce(run: () => void): () => void;

export function App({ children }: { children: ReactNode }) {
  const [, setCount] = useState(0);
  const run = () => setCount(1);
  const save = useCallback(debounce(run), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
