import { requiredContext } from "./guarantees";

export type Theme = { dark: boolean };
export type User = { name: string };

export const ThemeContext = requiredContext<Theme>();
export const AuthContext = requiredContext<User>();
export const LocaleContext = requiredContext<string>();
