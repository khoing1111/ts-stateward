import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
let current = { save: () => undefined };

export function bump(): void {
  current = { save: () => undefined };
}

export function App({ children }: { children: ReactNode }) {
  return <ActionsContext.Provider value={current}>{children}</ActionsContext.Provider>;
}
