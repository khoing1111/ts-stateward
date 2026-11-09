import { useState, type ReactNode } from "react";
import { StoreContext, type Store } from "./contexts";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => ({ items: [] }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** Provides the store around whatever it is given. */
export function Layout({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => ({ items: [] }));
  return (
    <main>
      <StoreContext value={store}>{children}</StoreContext>
    </main>
  );
}
