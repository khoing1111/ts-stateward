import { useState } from "react";
import { StoreContext } from "./contexts.js";
import { Wrap } from "./parts.js";

export function App() {
  const [store] = useState({ n: 1 });
  return (
    <StoreContext.Provider value={store}>
      <Wrap>
        <span />
      </Wrap>
    </StoreContext.Provider>
  );
}
