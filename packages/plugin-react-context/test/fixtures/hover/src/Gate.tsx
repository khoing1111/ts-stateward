import type { ReactNode } from "react";
import { useRequired } from "./required";
import { AuthCtx, ThemeCtx } from "./contexts";

export function Gate({ children }: { children: ReactNode }) {
  const user = useRequired(AuthCtx);
  return <ThemeCtx.Provider value={{ dark: Boolean(user.name) }}>{children}</ThemeCtx.Provider>;
}
