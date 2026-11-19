import { useState } from "react";
import { StoreContext } from "./contexts.js";
import { Inner } from "./parts.js";

export function App() {
  const [store] = useState({ n: 1 });
  return (
    <>
      <Inner><span /></Inner>
      <StoreContext.Provider value={store}><span /></StoreContext.Provider>
    </>
  );
}
