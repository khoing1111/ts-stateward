import type { ReactNode } from "react";
import { AuthCtx } from "./contexts";

export function Wrapper({ children }: { children: ReactNode }) {
  return (
    <div>
      <AuthCtx.Provider value={{ name: "ada" }}>{children}</AuthCtx.Provider>
      {children}
    </div>
  );
}
