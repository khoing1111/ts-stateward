import type { ReactNode } from "react";
import { AuthCtx } from "./contexts";

export function AuthGate(props: { children: ReactNode }) {
  return <AuthCtx.Provider value={{ name: "ada" }}>{props.children}</AuthCtx.Provider>;
}
