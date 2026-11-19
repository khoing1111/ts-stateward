import { useState } from "react";
import { StoreContext } from "./contexts.js";

function Inner({ children }: { children: React.ReactNode }) {
  const [store] = useState({ n: 2 });
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function App() {
  const [store] = useState({ n: 1 });
  return (
    <StoreContext.Provider value={store}>
      <Inner>{null}</Inner>
    </StoreContext.Provider>
  );
}
