import { useTheme } from "./useTheme";

export function Menu() {
  const theme = useTheme();
  return <nav>{theme.dark ? "dark" : "light"}</nav>;
}
