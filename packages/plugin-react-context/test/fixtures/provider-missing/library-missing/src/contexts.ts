import { createContext } from "react";

export type User = { name: string };
export type Theme = { dark: boolean };

export const AuthCtx = createContext<User | undefined>(undefined);
export const ThemeCtx = createContext<Theme | undefined>(undefined);
