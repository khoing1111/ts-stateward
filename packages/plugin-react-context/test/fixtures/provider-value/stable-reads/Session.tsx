import { createContext, useCallback, useMemo, useState, type Context, type ReactNode } from "react";
import type { Stable } from "./guarantees.js";

type Session = { user: string; setUser: (user: string) => void };

export const SessionContext: Context<Session | null> & Stable = createContext<Session | null>(null);
export const ActionContext: Context<() => void> & Stable = createContext<() => void>(() => {});

type Props = { children: ReactNode };

/** The value reads `user` (state) and is a new object every render. */
export function Fresh({ children }: Props) {
  const [user, setUser] = useState("");
  return <SessionContext value={{ user, setUser }}>{children}</SessionContext>;
}

/** The dependency list leaves `user` out: the memo keeps the first one. */
export function MissingDependency({ children }: Props) {
  const [user, setUser] = useState("");
  const value = useMemo(() => ({ user, setUser }), [setUser]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

/** The same through `useCallback`, reading a prop. */
export function MissingInCallback({ children, label }: Props & { label: string }) {
  const [, setUser] = useState("");
  const reset = useCallback(() => setUser(label), [setUser]);
  return <ActionContext value={reset}>{children}</ActionContext>;
}

/** Listed: the value changes with `user`, which is the other finding. */
export function Listed({ children }: Props) {
  const [user, setUser] = useState("");
  const value = useMemo(() => ({ user, setUser }), [user, setUser]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

/** Only a setter: proven. */
export function OnlySetter({ children }: Props) {
  const [, setUser] = useState("");
  const value = useMemo(() => ({ user: "", setUser }), [setUser]);
  return <SessionContext value={value}>{children}</SessionContext>;
}
