import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
import { makeActions } from "./make.js";

export function App({ children }: { children: ReactNode }) {
  const [made] = useState(makeActions);
  const value = useMemo(() => ({ save: made.save }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
