import { useRequired } from "./required";
import { AuthCtx } from "./contexts";

export function Leaf() {
  const user = useRequired(AuthCtx);
  return <h1>{user.name}</h1>;
}
