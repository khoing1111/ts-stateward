import { useContext, useState, type ReactNode } from "react";
import { ThemeContext } from "./contexts.js";

export function Reader() {
  return <p>{useContext(ThemeContext).color}</p>;
}

export function Wrap({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
