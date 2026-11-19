import { settings } from "./settings.js";

function bump(m: { n: number }): void {
  m.n = m.n + 1;
}

type S = Readonly<{ theme: string; meta: Readonly<{ n: number }> }>;

export function View(props: { s: S }) {
  bump(props.s.meta);
  return <p>{props.s.theme}</p>;
}

export function App() {
  return <View s={settings} />;
}
