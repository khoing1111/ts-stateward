import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children, ...props }: { children: ReactNode; value: { save: () => void } }) {
  return <ActionsContext.Provider {...props}>{children}</ActionsContext.Provider>;
}
