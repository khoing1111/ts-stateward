import { createContext } from "react";

export type User = { name: string };

export const AuthCtx = createContext<User | undefined>(undefined);
