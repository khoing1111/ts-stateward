import { settings } from "./settings.js";

function show(m: Readonly<{ n: number }>): string {
  return String(m.n);
}

type S = Readonly<{ theme: string; meta: Readonly<{ n: number }> }>;

export function View(props: { s: S }) {
  return (
    <p>
      {props.s.theme} {show(props.s.meta)}
    </p>
  );
}

export function App() {
  return <View s={settings} />;
}
