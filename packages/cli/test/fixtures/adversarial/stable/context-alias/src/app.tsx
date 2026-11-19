import { type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";

const C = ActionsContext;

export function App({ children, onSave }: { children: ReactNode; onSave: (u: string) => void }): ReactNode {
  return <C value={{ save: () => onSave("x") }}>{children}</C>;
}
