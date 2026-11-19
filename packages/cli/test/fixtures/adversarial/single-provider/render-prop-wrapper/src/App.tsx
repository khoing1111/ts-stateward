import { useState, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";
import { Inner, Wrap } from "./parts.js";

const wrapInner = (c: ReactNode) => <Inner>{c}</Inner>;

export function App() {
  const [store] = useState({ n: 1 });
  return (
    <StoreContext.Provider value={store}>
      <Wrap wrap={wrapInner}>
        <span />
      </Wrap>
    </StoreContext.Provider>
  );
}
