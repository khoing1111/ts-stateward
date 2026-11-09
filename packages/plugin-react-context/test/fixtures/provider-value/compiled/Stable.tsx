import { createContext, useReducer, type Context, type ReactNode } from "react";
import type { Stable } from "./guarantees.js";

type Actions = { add: (item: string) => void; count: number };

export const ActionsContext: Context<Actions | null> & Stable = createContext<Actions | null>(null);

function reducer(items: string[], item: string): string[] {
  return [...items, item];
}

/** The React Compiler memoizes the literal by what it reads: `dispatch` never changes. */
export function OverDispatch({ children }: { children: ReactNode }) {
  const [, dispatch] = useReducer(reducer, []);
  return <ActionsContext value={{ add: dispatch, count: 0 }}>{children}</ActionsContext>;
}

/** It reads `items`, state: the memoized value changes with it. */
export function OverState({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(reducer, []);
  return <ActionsContext value={{ add: dispatch, count: items.length }}>{children}</ActionsContext>;
}
