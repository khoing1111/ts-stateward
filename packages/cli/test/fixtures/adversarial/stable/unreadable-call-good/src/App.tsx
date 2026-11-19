import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
import { makeActions } from "./make.js";

export function App({ children }: { children: ReactNode }) {
  const [actions] = useState(makeActions);
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}
