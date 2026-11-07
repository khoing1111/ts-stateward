import { useContext } from "react";
import { SessionCtx } from "./index";

export function Profile() {
  return <h1>{useContext(SessionCtx).name}</h1>;
}
