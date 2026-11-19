import { ActionsContext } from "./contexts.js";

declare function post(): Promise<void>;

export function App({ children }: { children: React.ReactNode }) {
  return <ActionsContext.Provider value={{ save: () => void post() }}>{children}</ActionsContext.Provider>;
}
