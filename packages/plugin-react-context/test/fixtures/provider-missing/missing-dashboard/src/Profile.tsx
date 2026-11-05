import { useRequired } from "./required";
import { AuthCtx } from "./contexts";

export function Profile() {
  const user = useRequired(AuthCtx);
  return <h1>{user.name}</h1>;
}
