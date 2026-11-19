import type { ReactNode } from "react";
import { ActionsContext, type Actions } from "./contexts.js";

class Store {
  actions: Actions = { save: () => undefined };

  refresh(): void {
    this.actions = { save: () => undefined };
  }
}

const store = new Store();

export function refresh(): void {
  store.refresh();
}

export function App({ children }: { children: ReactNode }) {
  return <ActionsContext.Provider value={store.actions}>{children}</ActionsContext.Provider>;
}
