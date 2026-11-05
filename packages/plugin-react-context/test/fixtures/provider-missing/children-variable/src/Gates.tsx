import type { ReactNode } from "react";
import { AuthCtx, ThemeCtx } from "./contexts";

type GateProps = { children: ReactNode; loading?: boolean };

export function AuthGate({ children }: GateProps) {
  const body = <div className="page">{children}</div>;
  return <AuthCtx.Provider value={{ name: "ada" }}>{body}</AuthCtx.Provider>;
}

export function ThemeGate({ children, loading }: GateProps) {
  const content = loading ? <p>loading</p> : children;
  return <ThemeCtx.Provider value={{ dark: true }}>{content}</ThemeCtx.Provider>;
}

export function LeakyGate({ children }: GateProps) {
  const body = <div className="page">{children}</div>;
  return (
    <>
      <AuthCtx.Provider value={{ name: "ada" }}>
        <p>header</p>
      </AuthCtx.Provider>
      {body}
    </>
  );
}
