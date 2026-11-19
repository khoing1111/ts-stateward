import { useState, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";

export function App(): ReactNode {
  const [store] = useState(() => ({ n: 1 }));
  const inner = (
    <StoreContext.Provider value={store}>
      <p />
    </StoreContext.Provider>
  );
  return <StoreContext.Provider value={store}>{inner}</StoreContext.Provider>;
}
