import { useRequired } from "./required";
import { Avatar } from "./Avatar";
import { AuthCtx } from "./contexts";

export function Profile() {
  const user = useRequired(AuthCtx);
  return (
    <h1>
      {user.name}
      <Avatar />
    </h1>
  );
}
