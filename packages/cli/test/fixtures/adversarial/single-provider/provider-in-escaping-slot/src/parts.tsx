import type { ReactNode } from "react";

export function Wrap({ wrap, children }: { wrap: (c: ReactNode) => ReactNode; children: ReactNode }) {
  return <>{wrap(children)}</>;
}
