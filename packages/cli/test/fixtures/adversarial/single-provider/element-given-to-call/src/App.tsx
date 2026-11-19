import { useState, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";
import { Inner } from "./parts.js";

declare function toast(node: ReactNode): void;

export function App() {
  const [store] = useState({ n: 1 });
  toast(<Inner><span /></Inner>);
  return <StoreContext.Provider value={store}><span /></StoreContext.Provider>;
}
