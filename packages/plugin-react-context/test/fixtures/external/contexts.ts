import { createContext } from "react";

export type User = { name: string };

// Declared outside the project the fixtures check, like a context of a workspace package.
export const AuthCtx = createContext<User | undefined>(undefined);
