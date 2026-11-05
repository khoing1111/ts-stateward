import { createContext, useContext } from "react";

export type Theme = { dark: boolean };

// No reader checks the value, so the code does not say a Provider must be there.
export const ThemeContext = createContext<Theme | undefined>(undefined);

export function Badge() {
  const theme = useContext(ThemeContext);
  return <span>{theme?.dark === true ? "dark" : "light"}</span>;
}
