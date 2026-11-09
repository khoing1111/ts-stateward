import { useState, type ReactNode } from "react";
import { ModeContext, StoreContext, type Store } from "./stores";

const store: Store = { items: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState("light");
  return (
    <ModeContext.Provider value={mode}>
      <button onClick={() => setMode("dark")}>dark</button>
      {children}
    </ModeContext.Provider>
  );
}
