import { useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";

export function App({ children }: { children: ReactNode }): ReactNode {
  const [actions] = useState(() => ({ save: () => undefined }));
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}
