import { useContext, type ReactNode } from "react";
import { ThemeContext, type Theme } from "./ctx.js";

function useTheme(): Theme {
  return useContext(ThemeContext);
}

function Reader(): ReactNode {
  return <p>{useTheme().color}</p>;
}

export function App(): ReactNode {
  return (
    <ThemeContext.Provider value={{ color: "red" }}>
      <Reader />
    </ThemeContext.Provider>
  );
}
