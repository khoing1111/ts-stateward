import { type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";

const Prov = ActionsContext.Provider;

export function App({ children, onSave }: { children: ReactNode; onSave: (u: string) => void }): ReactNode {
  return <Prov value={{ save: () => onSave("x") }}>{children}</Prov>;
}
