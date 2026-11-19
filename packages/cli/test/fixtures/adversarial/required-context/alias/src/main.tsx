import { useContext, type ReactNode } from "react";
import { ThemeContext } from "./ctx.js";

const C = ThemeContext;

function Reader(): ReactNode {
  return <p>{useContext(C).color}</p>;
}

export function App(): ReactNode {
  return <Reader />;
}
