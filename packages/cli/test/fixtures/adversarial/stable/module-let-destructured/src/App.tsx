import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
let current = 1;

export function bump(list: number[]): void {
  [current] = list;
}

export function App({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ save: () => console.log(current) }), []);
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}
