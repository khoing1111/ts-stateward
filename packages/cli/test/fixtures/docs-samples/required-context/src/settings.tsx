import { useContext, type ComponentType } from "react";
import { requiredContext } from "./guarantees";

type Theme = { color: string };
export const ThemeContext = requiredContext<Theme>();

function Page() {
  return <p>{useContext(ThemeContext).color}</p>;
}

declare const pages: Record<string, ComponentType>;

export function Settings({ tab }: { tab: string }) {
  const Picked = pages[tab];
  return <Picked />;
}

export function App() {
  return (
    <>
      <Settings tab="page" />
      <ThemeContext value={{ color: "red" }}>
        <Page />
      </ThemeContext>
    </>
  );
}
