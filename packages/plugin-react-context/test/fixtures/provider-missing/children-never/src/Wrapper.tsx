import type { ReactNode } from "react";

export function Wrapper({ children }: { children: ReactNode }) {
  return <div>{children.toString().length}</div>;
}
