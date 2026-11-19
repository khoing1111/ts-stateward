import { useContext, useState, type Context, type ReactNode } from "react";
import { StoreContext } from "./contexts.js";

function useStore<T>(context: Context<T>): T {
  return useContext(context);
}

function Reader(): ReactNode {
  return <p>{useStore(StoreContext)?.n}</p>;
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
