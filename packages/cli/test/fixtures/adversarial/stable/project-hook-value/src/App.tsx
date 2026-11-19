import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
function useActions() {
  const [n] = useState(0);
  return { save: () => console.log(n) };
}

export function App({ children }: { children: ReactNode }) {
  const actions = useActions();
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}
