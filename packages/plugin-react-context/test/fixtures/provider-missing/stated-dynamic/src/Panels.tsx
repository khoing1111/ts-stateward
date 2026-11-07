import { useContext } from "react";
import { ThemeCtx } from "./contexts";

export function Settings() {
  return <p>{useContext(ThemeCtx).dark ? "dark" : "light"}</p>;
}

export function About() {
  return <p>about</p>;
}

const panels: Record<string, () => React.JSX.Element> = { settings: Settings, about: About };

export function Dashboard({ tab }: { tab: string }) {
  const Panel = panels[tab] ?? About;
  return <Panel />;
}
