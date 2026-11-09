import { createContext, useReducer, useRef, useState, type Context, type ReactNode } from "react";
import type { Stable } from "./guarantees.js";

type Store = { items: string[] };

function createStore(): Store {
  return { items: [] };
}

export const StoreContext: Context<Store | null> & Stable = createContext<Store | null>(null);

type Props = { children: ReactNode };

/** No setter taken: the store keeps its first value. */
export function NoSetter({ children }: Props) {
  const [store] = useState(createStore);
  return <StoreContext value={store}>{children}</StoreContext>;
}

/** A setter bound and never read: the same. */
export function UnusedSetter({ children }: Props) {
  const [store, setStore] = useState(createStore);
  return <StoreContext value={store}>{children}</StoreContext>;
}

/** A reducer whose `dispatch` is never taken. */
export function NoDispatch({ children }: Props) {
  const [store] = useReducer((state: Store) => state, undefined, createStore);
  return <StoreContext value={store}>{children}</StoreContext>;
}

/** A setter that is called: the store changes. */
export function UsedSetter({ children }: Props) {
  const [store, setStore] = useState(createStore);
  return (
    <StoreContext value={store}>
      <button onClick={() => setStore(createStore())}>reset</button>
      {children}
    </StoreContext>
  );
}

/** A setter handed on through the rest of the tuple: the store changes. */
export function RestSetter({ children }: Props) {
  const [store, ...rest] = useState(createStore);
  return <StoreContext value={store}>{rest.length > 0 && children}</StoreContext>;
}

/** What a ref holds is meant to change. */
export function RefCurrent({ children }: Props) {
  const ref = useRef<Store>(createStore());
  return <StoreContext value={ref.current}>{children}</StoreContext>;
}
