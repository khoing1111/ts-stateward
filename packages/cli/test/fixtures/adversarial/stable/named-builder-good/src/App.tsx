import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children }: { children: ReactNode }) {
  const [, setCount] = useState(0);
  const build = () => ({ save: () => setCount(1) });
  const value = useMemo(build, []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
