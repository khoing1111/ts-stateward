import type { ReactNode } from "react";
import { AuthCtx } from "./contexts";

export function AuthGate({ children }: { children: ReactNode }) {
  return <AuthCtx.Provider value={{ name: "ada" }}>{children}</AuthCtx.Provider>;
}
