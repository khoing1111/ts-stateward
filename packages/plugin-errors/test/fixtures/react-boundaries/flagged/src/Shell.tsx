import type { ReactNode } from "react";

export function Shell({ children }: { children?: ReactNode }) {
  return (
    <main>
      <nav>Users · Settings · Dashboard</nav>
      {children}
    </main>
  );
}
