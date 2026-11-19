import { useContext, type ReactNode } from "react";
import { ThemeContext } from "./ctx.js";

const contexts = { theme: ThemeContext };

function Reader(): ReactNode {
  return <p>{useContext(contexts.theme).color}</p>;
}

export function App(): ReactNode {
  return <Reader />;
}
