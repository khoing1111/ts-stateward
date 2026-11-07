import { useContext } from "react";
import { ThemeCtx } from "@acme/ui";

export function Toolbar() {
  return <nav>{useContext(ThemeCtx).dark ? "dark" : "light"}</nav>;
}
