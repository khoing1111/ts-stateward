import { useState } from "react";
import { StoreContext } from "./contexts.js";

export function Tree({ depth }: { depth: number }) {
  const [store] = useState({ n: depth });
  return (
    <StoreContext.Provider value={store}>
      {depth > 0 ? <Tree depth={depth - 1} /> : null}
    </StoreContext.Provider>
  );
}

export function App() {
  return <Tree depth={2} />;
}
