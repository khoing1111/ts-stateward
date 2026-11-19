import { useMemo, useRef, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";

type Props = { children: ReactNode; onSave: () => void };

export function ActionsProvider({ children, onSave }: Props): ReactNode {
  const latest = useRef(onSave);
  latest.current = onSave;
  const value = useMemo(() => ({ save: () => latest.current() }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
