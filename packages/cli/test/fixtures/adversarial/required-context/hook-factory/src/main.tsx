import { useContext, type Context, type ReactNode } from "react";
import { ThemeContext } from "./ctx.js";

const makeHook =
  <T,>(context: Context<T>) =>
  () =>
    useContext(context);
const useTheme = makeHook(ThemeContext);

function Reader(): ReactNode {
  return <p>{useTheme().color}</p>;
}

export function App(): ReactNode {
  return <Reader />;
}
