import { use, useContext } from "react";
import { ThemeCtx } from "./contexts";
import { useTheme } from "./useTheme";

export function Plain() {
  return <p>{useContext(ThemeCtx).dark ? "dark" : "light"}</p>;
}

export function WithUse() {
  return <p>{use(ThemeCtx).dark ? "dark" : "light"}</p>;
}

export function WithConsumer() {
  return <ThemeCtx.Consumer>{(theme) => <p>{theme.dark ? "dark" : "light"}</p>}</ThemeCtx.Consumer>;
}

export function WithHook() {
  return <p>{useTheme().dark ? "dark" : "light"}</p>;
}
