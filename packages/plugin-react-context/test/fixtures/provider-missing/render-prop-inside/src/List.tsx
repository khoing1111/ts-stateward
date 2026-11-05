import type { ReactNode } from "react";
import { AuthCtx } from "./contexts";

export function List({ renderItem }: { renderItem: (id: number) => ReactNode }) {
  return <AuthCtx.Provider value={{ name: "ada" }}>{renderItem(1)}</AuthCtx.Provider>;
}
