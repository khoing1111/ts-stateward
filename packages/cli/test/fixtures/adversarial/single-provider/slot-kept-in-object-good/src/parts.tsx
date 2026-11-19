import type { ReactNode } from "react";

export function Wrap({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
