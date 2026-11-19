import { useState, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";

export function Inner({ children }: { children: ReactNode }) {
  const [store] = useState({ n: 2 });
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function Wrap({ wrap, children }: { wrap: (c: ReactNode) => ReactNode; children: ReactNode }) {
  return <>{wrap(children)}</>;
}
