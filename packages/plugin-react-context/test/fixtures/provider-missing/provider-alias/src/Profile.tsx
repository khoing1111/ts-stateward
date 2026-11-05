import { useRequired } from "./required";
import { AuthCtx, ThemeCtx } from "./contexts";

export function Profile() {
  const user = useRequired(AuthCtx);
  return <h1>{user.name}</h1>;
}

export function Themed() {
  const theme = useRequired(ThemeCtx);
  return <i>{String(theme.dark)}</i>;
}
