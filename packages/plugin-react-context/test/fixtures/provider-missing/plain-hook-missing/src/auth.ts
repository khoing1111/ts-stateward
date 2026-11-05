import { createContext, useContext } from "react";

export type User = { name: string };

export const AuthContext = createContext<User | undefined>(undefined);

export function useAuth(): User {
  const user = useContext(AuthContext);
  if (!user) throw new Error("useAuth must be used within AuthContext.Provider");
  return user;
}
