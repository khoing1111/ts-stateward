import { useContext, useState, type Context, type ReactNode } from "react";
import { StoreContext, type Store } from "./contexts.js";

function useStore<T>(context: Context<T>): T {
  return useContext(context);
}

function provide(context: Context<Store | undefined>, value: Store, children: ReactNode): ReactNode {
  return <context.Provider value={value}>{children}</context.Provider>;
}

function Reader(): ReactNode {
  return <p>{useStore(StoreContext)?.n}</p>;
}

function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [store] = useState(() => ({ n: 1 }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function Inner({ children }: { children: ReactNode }): ReactNode {
  const [store] = useState(() => ({ n: 2 }));
  return provide(StoreContext, store, children);
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
