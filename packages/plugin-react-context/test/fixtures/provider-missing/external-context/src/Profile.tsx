import { useRequired } from "./required";
import { AuthCtx } from "../../../external/contexts";

export function Profile() {
  const user = useRequired(AuthCtx);
  return <h1>{user.name}</h1>;
}

export function Settings() {
  const user = useRequired(AuthCtx);
  return <p>{user.name}</p>;
}
