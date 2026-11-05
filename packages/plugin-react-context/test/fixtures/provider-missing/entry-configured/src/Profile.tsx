import { useRequired } from "./required";
import { AuthCtx, ThemeCtx } from "./contexts";

export function Profile() {
  const user = useRequired(AuthCtx);
  const theme = useRequired(ThemeCtx);
  return <h1 className={theme.dark ? "dark" : "light"}>{user.name}</h1>;
}
