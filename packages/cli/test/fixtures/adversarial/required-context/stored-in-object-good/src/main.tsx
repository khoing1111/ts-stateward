import { useContext, type ReactNode } from "react";
import { ThemeContext } from "./ctx.js";

function Reader(): ReactNode {
  return <p>{useContext(ThemeContext).color}</p>;
}

export function App(): ReactNode {
  return (
    <ThemeContext value={{ color: "red" }}>
      <Reader />
    </ThemeContext>
  );
}
