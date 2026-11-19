import { useContext, useState, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";

function Reader(): ReactNode {
  return <p>{useContext(StoreContext)?.n}</p>;
}

function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [store] = useState(() => ({ n: 1 }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function Inner({ children }: { children: ReactNode }): ReactNode {
  return <section>{children}</section>;
}

export function App(): ReactNode {
  return (
    <StoreProvider>
      <Inner>
        <Reader />
      </Inner>
    </StoreProvider>
  );
}
