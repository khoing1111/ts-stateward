import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ActionsContext } from "./contexts.js";
export function App({ children, onSave }: { children: ReactNode; onSave: (user: string) => void }) {
  const [user, setUser] = useState("ann");
  const helper = () => onSave(user);
  const save = useCallback(() => helper(), []);
  const value = useMemo(() => ({ save }), [save]);
  return (
    <ActionsContext.Provider value={value}>
      <button onClick={() => setUser("bob")}>x</button>
      {children}
    </ActionsContext.Provider>
  );
}
