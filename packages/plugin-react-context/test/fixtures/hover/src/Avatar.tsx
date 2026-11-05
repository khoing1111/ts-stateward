import { useRequired } from "./required";
import { ThemeCtx } from "./contexts";

export function Avatar() {
  const theme = useRequired(ThemeCtx);
  return <img alt={theme.dark ? "dark" : "light"} />;
}
