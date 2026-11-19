import type { ReactNode } from "react";
import { ActionsContext, type Actions } from "./contexts.js";

class Store {
  readonly actions: Actions = { save: () => undefined };
}

const store = new Store();

export function App({ children }: { children: ReactNode }) {
  return <ActionsContext.Provider value={store.actions}>{children}</ActionsContext.Provider>;
}
