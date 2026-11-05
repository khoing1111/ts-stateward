import { useRequired } from "../required";
import { ThemeCtx } from "../contexts";

export function Settings() {
  const theme = useRequired(ThemeCtx);
  return <p>{theme.dark ? "dark" : "light"}</p>;
}

export default function Home() {
  return <p>home</p>;
}
