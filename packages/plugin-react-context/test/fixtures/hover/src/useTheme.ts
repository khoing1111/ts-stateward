import { useRequired } from "./required";
import { ThemeCtx } from "./contexts";

export function useTheme() {
  return useRequired(ThemeCtx);
}
