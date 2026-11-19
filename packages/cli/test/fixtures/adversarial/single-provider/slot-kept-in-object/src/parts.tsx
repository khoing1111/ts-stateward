import type { ReactNode } from "react";

export function Wrap({ children }: { children: ReactNode }) {
  const holder = { child: children };
  return <div>{holder.child}</div>;
}
