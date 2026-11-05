import { createContext, useContext } from "react";

export type Theme = { dark: boolean };

export const ThemeContext = createContext<Theme | null>(null);

/** Checks the value and renders nothing without it: the code says the Provider must be there. */
export function Badge() {
  const theme = useContext(ThemeContext);
  if (theme === null) return null;
  return <span>{theme.dark ? "dark" : "light"}</span>;
}

function fail(message: string): never {
  throw new Error(message);
}

/** A call that never returns counts as leaving too. */
export function Banner() {
  const theme = useContext(ThemeContext);
  if (theme == null) fail("Banner needs a ThemeContext Provider");
  return <div>{theme.dark ? "dark" : "light"}</div>;
}
