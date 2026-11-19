import type { ReactNode } from "react";
import { ThemeContext } from "./contexts.js";
import { Reader, Wrap } from "./parts.js";

const wrapTheme = (c: ReactNode) => <ThemeContext value={{ color: "red" }}>{c}</ThemeContext>;

export function App() {
  return (
    <Wrap wrap={wrapTheme}>
      <Reader />
    </Wrap>
  );
}
