import { Outlet } from "react-router-dom";
import { AuthCtx } from "./contexts";

export function Layout() {
  return (
    <AuthCtx.Provider value={{ name: "ada" }}>
      <Outlet />
    </AuthCtx.Provider>
  );
}
