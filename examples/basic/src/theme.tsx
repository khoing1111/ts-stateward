import { createContext, useContext } from "react";

export type Theme = { color: string };

export const ThemeContext = createContext({});

export function Toolbar() {
  const theme = useContext(ThemeContext);
  return <div data-theme={JSON.stringify(theme)}>toolbar</div>;
}
