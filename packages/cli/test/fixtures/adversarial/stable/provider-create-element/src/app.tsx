import { createElement, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";

export function App({ children, onSave }: { children: ReactNode; onSave: (u: string) => void }): ReactNode {
  return createElement(ActionsContext.Provider, { value: { save: () => onSave("x") } }, children);
}
