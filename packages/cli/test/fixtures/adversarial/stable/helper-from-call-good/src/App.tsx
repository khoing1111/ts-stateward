import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
import { makeHelper } from "./make.js";

export function App({ children }: { children: ReactNode }) {
  const [, setUser] = useState("");
  const [helper] = useState(() => makeHelper(setUser));
  const save = useCallback(() => helper(), []);
  const value = useMemo(() => ({ save }), [save]);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
