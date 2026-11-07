import { useContext } from "react";
import { ThemeCtx } from "./contexts";

export function useTheme() {
  const theme = useContext(ThemeCtx);
  if (theme === undefined) throw new Error("useTheme needs a ThemeCtx Provider");
  return theme;
}
