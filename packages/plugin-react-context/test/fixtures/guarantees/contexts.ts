import { createContext, type Context } from "react";
import type { RequiredContext } from "./guarantees.js";

type Theme = { dark: boolean };

/** Stated required, but made with a cast outside the helper. */
export const ThemeContext: RequiredContext<Theme> = createContext<Theme>(undefined as never);

/** A function that makes a plain context: its cast is a placeholder like any other. */
export function plainContext<T>(): Context<T> {
  return createContext<T>(undefined as never);
}
