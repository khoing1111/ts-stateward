import type { ComponentType } from "react";
import { AuthCtx } from "./contexts";

export function Panel({ as: As }: { as: ComponentType }) {
  return (
    <AuthCtx.Provider value={{ name: "ada" }}>
      <As />
    </AuthCtx.Provider>
  );
}
