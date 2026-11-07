import { useContext } from "react";
import { AuthCtx } from "./contexts";

export function useAuth() {
  const user = useContext(AuthCtx);
  if (user === undefined) throw new Error("useAuth needs an AuthCtx Provider");
  return user;
}
