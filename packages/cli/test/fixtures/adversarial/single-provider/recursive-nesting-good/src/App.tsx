import { useState } from "react";
import { StoreContext } from "./contexts.js";

export function Tree({ depth }: { depth: number }) {
  return <p>{depth > 0 ? <Tree depth={depth - 1} /> : null}</p>;
}

export function App() {
  const [store] = useState({ n: 1 });
  return (
    <StoreContext.Provider value={store}>
      <Tree depth={2} />
    </StoreContext.Provider>
  );
}
