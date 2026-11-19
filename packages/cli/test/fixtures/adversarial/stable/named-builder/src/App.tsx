import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children, onSave }: { children: ReactNode; onSave: () => void }) {
  const build = () => ({ save: onSave });
  const value = useMemo(build, []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
