import { useState } from "react";
import { StoreContext } from "./contexts.js";

export function App() {
  const [store] = useState({ n: 1 });
  return <StoreContext.Provider value={store}>{null}</StoreContext.Provider>;
}
