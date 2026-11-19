import { useContext, useState, type ReactNode } from "react";
import { ThemeContext } from "./contexts.js";

export function Reader() {
  return <p>{useContext(ThemeContext).color}</p>;
}

export function Wrap({ wrap, children }: { wrap: (c: ReactNode) => ReactNode; children: ReactNode }) {
  return <>{wrap(children)}</>;
}
