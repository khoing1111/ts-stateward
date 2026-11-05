import type { ReactNode } from "react";
import { ThemeCtx } from "./contexts";

export function Shell({ children }: { children: ReactNode }) {
  return <ThemeCtx.Provider value={{ dark: true }}>{children}</ThemeCtx.Provider>;
}
