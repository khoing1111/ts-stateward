import { createContext, use, useContext, useRef, type RefObject } from "react";

export type Cart = {
  items: string[];
  count: number;
  draft?: string;
  byId: Map<string, string>;
  tags: Set<string>;
  add: (item: string) => void;
  input: RefObject<HTMLInputElement | null>;
};

export const CartContext = createContext<Cart | undefined>(undefined);

export function useCart(): Cart {
  const cart = useContext(CartContext);
  if (cart === undefined) throw new Error("useCart needs a CartContext Provider");
  return cart;
}

/** A class instance changes its own fields by design (a MobX store, for example). */
export class Store {
  count = 0;
  items: string[] = [];
}
export const StoreContext = createContext(new Store());

/** Every kind of write to the value. */
export function AddButton({ item }: { item: string }) {
  const cart = useContext(CartContext);
  if (cart === undefined) return null;
  const { items } = cart;
  const byId = cart.byId;
  return (
    <button
      onClick={() => {
        cart.items.push(item);
        cart.count += 1;
        cart.count++;
        delete cart.draft;
        items.sort();
        byId.set(item, item);
        cart.tags.add(item);
        Object.assign(cart, { count: 0 });
      }}
    >
      Add
    </button>
  );
}

/** Through a hook of the project that returns the value, and through `use`. */
export function Clear() {
  const cart = useCart();
  const other = use(CartContext);
  return (
    <button
      onClick={() => {
        cart.items = [];
        if (other !== undefined) other.items.splice(0);
      }}
    >
      Clear
    </button>
  );
}

/** Not reported: reading, copying, calling the context's function, a ref, a class field. */
export function Fine({ item }: { item: string }) {
  const cart = useCart();
  const store = useContext(StoreContext);
  const local = useRef<string[]>([]);
  const sorted = [...cart.items].sort();
  if (cart.input.current !== null) cart.input.current.value = item;
  local.current.push(item);
  store.count += 1;
  store.items.push(item);
  return (
    <button
      onClick={() => {
        cart.add(item);
      }}
    >
      {sorted.join(", ")}
    </button>
  );
}

/** Not a component or hook: not a reader. */
export function addLater(cart: Cart, item: string): void {
  cart.items.push(item);
}
